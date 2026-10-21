// Takeoff AI for AI apps that start their MCP servers as a command (Claude Desktop, Codex,
// most local-model apps). It is a pipe: each JSON-RPC line on stdin goes to the running
// Takeoff AI app's MCP server, and its answer comes back on stdout. If Takeoff AI isn't open,
// it is opened first. Run by the app's own binary as Node:
//
//   ELECTRON_RUN_AS_NODE=1 "<Takeoff AI binary>" "<Resources>/mcp-stdio.cjs" --connection "<userData>/mcp.json"
//
// mcp.json (written by the app each launch): { port, token, app }. Nothing but JSON-RPC goes
// to stdout; notes go to stderr.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Where the app keeps mcp.json when no --connection is given. */
function defaultConnectionFile() {
  const home = os.homedir();
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'Takeoff AI', 'mcp.json');
}

const connectionFile = arg('--connection') || process.env.TAKEOFF_MCP_CONNECTION || defaultConnectionFile();
const log = (...a) => process.stderr.write(`[takeoff-ai] ${a.join(' ')}\n`);

function readConnection() {
  try {
    const c = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    return c && c.port && c.token ? c : null;
  } catch {
    return null;
  }
}

function post(conn, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${conn.token}`,
          'Content-Length': data.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

let launching = null;
/** Opens Takeoff AI (once) and waits for its server to answer, up to 45 seconds. */
function launchAndWait() {
  launching ??= (async () => {
    const before = readConnection();
    const app = before?.app || arg('--app');
    // Never opened on this computer (no mcp.json yet) and no app given: nothing to open.
    if (!app) return null;
    {
      log('Opening Takeoff AI…');
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      try {
        if (process.platform === 'darwin' && /\.app$/.test(app)) spawn('open', ['-a', app], { detached: true, stdio: 'ignore', env }).unref();
        else spawn(app, [], { detached: true, stdio: 'ignore', env }).unref();
      } catch (e) {
        log('Could not open Takeoff AI:', e.message);
      }
    }
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 750));
      const conn = readConnection();
      if (!conn) continue;
      try {
        const r = await post(conn, JSON.stringify({ jsonrpc: '2.0', id: 'probe', method: 'ping' }));
        if (r.status === 200) return conn;
      } catch {
        // Not listening yet.
      }
    }
    return null;
  })().finally(() => {
    launching = null;
  });
  return launching;
}

async function forward(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const id = msg && msg.id;
  for (let attempt = 0; attempt < 2; attempt++) {
    let conn = readConnection();
    try {
      if (!conn) throw Object.assign(new Error('no connection file'), { code: 'ECONNREFUSED' });
      const r = await post(conn, line);
      if (r.status === 202) return; // a notification
      if (r.status === 401 && attempt === 0) continue; // token changed on a relaunch: read it again
      if (r.status !== 200) throw new Error(`Takeoff AI answered ${r.status}`);
      return process.stdout.write(r.text.trim() + '\n');
    } catch (e) {
      if (e.code === 'ECONNREFUSED' && attempt === 0) {
        conn = await launchAndWait();
        if (conn) continue;
        if (id !== undefined && id !== null)
          reply({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Takeoff AI is not running and could not be opened. Open the Takeoff AI app, then try again.' } });
        return;
      }
      if (id !== undefined && id !== null) reply({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
      return;
    }
  }
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
rl.on('line', (line) => {
  if (!line.trim()) return;
  const p = forward(line).catch((e) => log(e.message));
  pending.add(p);
  p.finally(() => pending.delete(p));
});
rl.on('close', async () => {
  await Promise.all(pending);
  process.exit(0);
});
