import { useEffect, useState } from 'react';
import { getApiKey, MODEL, setApiKey } from '../ai/claude';
import { checkAccess, getAccessCode, serviceBuild, setAccessCode, type AccessInfo } from '../ai/service';

/** The web app's access code: the server holds the model key and caps each code's daily use. */
function AccessCodeSection({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(getAccessCode() ?? '');
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const saved = getAccessCode();

  const check = async (c: string, save: boolean) => {
    setChecking(true);
    setError(null);
    try {
      const i = await checkAccess(c);
      setInfo(i);
      if (save) {
        setAccessCode(c);
        onDone();
      }
    } catch (e) {
      setInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (saved) void check(saved, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <label className="stack">
        Access code
        <input type="password" autoComplete="off" placeholder="From MMA Construction" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {info && (
        <p className="muted">
          Signed in as {info.name}. {info.used} of {info.limit} AI requests used today.
        </p>
      )}
      {error && <p className="field-hint error">{error}</p>}
      <p className="muted">
        AI features send only the sheet you choose to the AI model for reading. Your drawings and takeoffs stay on this computer.
      </p>
      <div className="row-actions">
        <button className="on" disabled={!code.trim() || checking} onClick={() => void check(code.trim(), true)}>
          {checking ? 'Checking…' : 'Save'}
        </button>
        {saved && (
          <button
            onClick={() => {
              setAccessCode(null);
              setCode('');
              setInfo(null);
            }}
          >
            Remove code
          </button>
        )}
      </div>
    </>
  );
}

function ApiKeySection({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState(getApiKey() ?? '');
  const saved = getApiKey();
  return (
    <>
      <label className="stack">
        Anthropic API key
        <input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <p className="muted">
        Get a key at console.anthropic.com. It is stored only in this browser on this computer. AI features send the
        sheet you choose to Anthropic's API; everything else stays local. Model: <code>{MODEL}</code>.
      </p>
      <div className="row-actions">
        <button
          className="on"
          disabled={!key.trim()}
          onClick={() => {
            setApiKey(key.trim());
            onDone();
          }}
        >
          Save
        </button>
        {saved && (
          <button
            onClick={() => {
              setApiKey(null);
              setKey('');
            }}
          >
            Remove key
          </button>
        )}
      </div>
    </>
  );
}

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>AI settings</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {serviceBuild ? <AccessCodeSection onDone={onClose} /> : <ApiKeySection onDone={onClose} />}
      </div>
    </div>
  );
}
