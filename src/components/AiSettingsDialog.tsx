import { useState } from 'react';
import { getApiKey, MODEL, setApiKey } from '../ai/claude';

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(getApiKey() ?? '');
  const saved = getApiKey();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>AI settings</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <label className="stack">
          Anthropic API key
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
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
              onClose();
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
      </div>
    </div>
  );
}
