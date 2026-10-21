import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startServer } = require('../electron/mcpServer.cjs') as {
  startServer(o: {
    port?: number;
    token: string;
    version?: string;
    tools: () => Promise<unknown[]>;
    call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): Promise<{ port: number; close: () => Promise<void> }>;
};
const folder = require('../electron/folder.cjs') as { writeExport(root: string, dir: string, name: string, data: ArrayBuffer): Promise<string> };

const TOKEN = 'test-token-123';
const tools = [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { say: { type: 'string' } } } }];
let server: { port: number; close: () => Promise<void> };
const calls: { name: string; args: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = await startServer({
    port: 47900 + Math.floor(Math.random() * 500),
    token: TOKEN,
    version: '9.9.9',
    tools: async () => tools,
    call: async (name, args) => {
      calls.push({ name, args });
      if (args.say === 'boom') throw new Error('it broke');
      return { content: [{ type: 'text', text: `you said ${String(args.say)}` }] };
    },
  });
});
afterAll(() => server.close());

async function rpc(body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

describe('MCP server', () => {
  it('initializes with the asked protocol version and instructions', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(r.status).toBe(200);
    expect(r.body.result.protocolVersion).toBe('2025-06-18');
    expect(r.body.result.serverInfo).toMatchObject({ name: 'takeoff-ai', version: '9.9.9' });
    expect(r.body.result.capabilities.tools).toBeTruthy();
    expect(r.body.result.instructions).toMatch(/sheet points/);
  });

  it('falls back to its newest version for an unknown one', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(r.body.result.protocolVersion).toBe('2025-11-25');
  });

  it('answers notifications with 202 and no body', async () => {
    const r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(r.status).toBe(202);
  });

  it('lists and calls tools', async () => {
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo']);
    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { say: 'hi' } } });
    expect(call.body.result.content[0].text).toBe('you said hi');
    expect(calls.at(-1)).toEqual({ name: 'echo', args: { say: 'hi' } });
  });

  it('turns a thrown tool error into an error result', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { say: 'boom' } } });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toBe('it broke');
  });

  it('rejects unknown tools and methods', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })).body.error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'sampling/x' })).body.error.code).toBe(-32601);
  });

  it('handles a batch', async () => {
    const r = await rpc([
      { jsonrpc: '2.0', id: 7, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(r.body).toEqual([{ jsonrpc: '2.0', id: 7, result: {} }]);
  });

  it('refuses a wrong token, a browser origin and a non-local host', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).status).toBe(401);
    // fetch can't set Host, so this one goes through node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path: '/mcp', method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    });
    expect(status).toBe(401);
  });

  it('takes the next port when one is busy', async () => {
    const other = await startServer({ port: server.port, token: TOKEN, tools: async () => [], call: async () => ({}) });
    expect(other.port).toBe(server.port + 1);
    await other.close();
  });
});

describe('MCP stdio pipe', () => {
  it('forwards JSON-RPC lines to the running app and prints the answers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcp-'));
    const conn = path.join(dir, 'mcp.json');
    await writeFile(conn, JSON.stringify({ port: server.port, token: TOKEN }));
    const child = spawn(process.execPath, [path.resolve('electron/mcp-stdio.cjs'), '--connection', conn], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { say: 'pipe' } } }) + '\n');
    child.stdin.end();
    await new Promise((r) => child.on('exit', r));
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.id === 1).result.serverInfo.name).toBe('takeoff-ai');
    expect(lines.find((l) => l.id === 2).result.content[0].text).toBe('you said pipe');
  });

  it('says so when the app is not running and cannot be opened', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcp-'));
    const child = spawn(process.execPath, [path.resolve('electron/mcp-stdio.cjs'), '--connection', path.join(dir, 'missing.json')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) + '\n');
    child.stdin.end();
    await new Promise((r) => child.on('exit', r));
    const msg = JSON.parse(out.trim());
    expect(msg.id).toBe(9);
    expect(msg.error.message).toMatch(/not running/);
  }, 20000);
});

describe('project Exports folder', () => {
  it('saves exports inside the project folder with a safe name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'proj-'));
    const file = await folder.writeExport(root, 'Kelso (abc12345)', 'Kelso: bid/v2 - takeoff.xlsx', new TextEncoder().encode('xlsx').buffer as ArrayBuffer);
    expect(file).toBe(path.join(root, 'Kelso (abc12345)', 'Exports', 'Kelso bid v2 - takeoff.xlsx'));
    expect(await readFile(file, 'utf8')).toBe('xlsx');
    await expect(folder.writeExport(root, '../outside', 'x.xlsx', new ArrayBuffer(1))).rejects.toThrow(/outside/);
  });
});
