import { useEffect, useState } from 'react';
import type { McpBridge, McpInfo } from '../desktop';

/** Snippets for each AI app, from the running server's details. */
export function connectSnippets(info: McpInfo) {
  const q = (s: string) => JSON.stringify(s);
  const claudeCode = `claude mcp add --transport http takeoff-ai ${info.url} --header "Authorization: Bearer ${info.token}"`;
  const codex = [
    '[mcp_servers.takeoff-ai]',
    `command = ${q(info.stdio.command)}`,
    `args = [${info.stdio.args.map(q).join(', ')}]`,
    `env = { ELECTRON_RUN_AS_NODE = "1" }`,
    'tool_timeout_sec = 900',
  ].join('\n');
  const json = JSON.stringify({ mcpServers: { 'takeoff-ai': info.stdio } }, null, 2);
  const http = JSON.stringify({ mcpServers: { 'takeoff-ai': { type: 'http', url: info.url, headers: { Authorization: `Bearer ${info.token}` } } } }, null, 2);
  return { claudeCode, codex, json, http };
}

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <strong>{label}</strong>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, margin: 0, padding: 8, borderRadius: 6, background: 'var(--panel-2, rgba(127,127,127,0.12))', maxHeight: 140, overflow: 'auto' }}>{text}</pre>
    </div>
  );
}

/**
 * Connect AI: lets Claude Desktop, Claude Code, Codex or a local-model app drive Takeoff AI
 * through its MCP server, on the user's own AI subscription. Nothing goes through MMA.
 */
export function ConnectAiDialog({ mcp, onClose }: { mcp: McpBridge; onClose: () => void }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    mcp
      .info()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void refresh();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snippets = info ? connectSnippets(info) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Connect AI" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <h3>Connect AI</h3>
          <button onClick={onClose} autoFocus>
            Done
          </button>
        </div>
        <p className="muted">
          Let Claude, ChatGPT/Codex or a local model work in Takeoff AI: open projects, add drawings, read sheets, run the automatic takeoffs, measure, and export. It uses your own AI
          subscription. Everything it does shows here and can be undone; its takeoffs are labelled AI until you check them.
        </p>
        {error && <p className="field-hint error">{error}</p>}
        {info && (
          <>
            <p>
              <strong>{info.running ? 'On' : 'Off'}</strong>
              <span className="muted"> · {info.running ? `listening on this computer only (${info.url})` : 'AI apps cannot reach Takeoff AI'}</span>
            </p>
            <div className="row-actions">
              <button
                className={info.inClaudeDesktop ? '' : 'on'}
                disabled={!info.running}
                onClick={async () => {
                  setError(null);
                  try {
                    const file = await mcp.addToClaudeDesktop();
                    setNote(`Added to Claude Desktop (${file}). Quit and reopen Claude Desktop, then ask it to use Takeoff AI.`);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {info.inClaudeDesktop ? 'Update in Claude Desktop' : 'Add to Claude Desktop'}
              </button>
              <button
                onClick={async () => {
                  await mcp.setEnabled(!info.running);
                  await refresh();
                }}
              >
                {info.running ? 'Turn off' : 'Turn on'}
              </button>
              <button
                onClick={async () => {
                  await mcp.newToken();
                  setNote('New key made. Apps set up with the old key need the new one (Claude Desktop and Codex pick it up by themselves).');
                  await refresh();
                }}
              >
                New key
              </button>
            </div>
            {note && <p className="field-hint">{note}</p>}
            {snippets && info.running && (
              <div className="stack" style={{ gap: 12, marginTop: 8 }}>
                <Snippet label="Claude Code (run in Terminal)" text={snippets.claudeCode} />
                <Snippet label="Codex (add to ~/.codex/config.toml)" text={snippets.codex} />
                <Snippet label="Other apps that run MCP servers as a command (LM Studio, Cursor…)" text={snippets.json} />
                <Snippet label="Apps that connect by URL" text={snippets.http} />
              </div>
            )}
            <p className="muted" style={{ marginTop: 8 }}>
              The key lets only apps you set up on this computer in. Takeoff AI opens by itself when an AI app needs it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
