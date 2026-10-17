import { useState, type ReactNode } from 'react';
import { checkAccess, getAccessCode, serviceBuild, setAccessCode } from '../ai/service';

/**
 * The web app asks for an access code before it opens. The code is checked with the
 * server once and kept in this browser, so it is asked for only the first time.
 * Desktop and local builds open straight away.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(!serviceBuild || !!getAccessCode());
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (ok) return <>{children}</>;

  const submit = async () => {
    const c = code.trim();
    if (!c) return;
    setChecking(true);
    setError(null);
    try {
      await checkAccess(c);
      setAccessCode(c);
      setOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="access-gate">
      <form
        className="access-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>Takeoff AI</h1>
        <p className="muted">Enter the access code you were given.</p>
        <input autoFocus autoComplete="off" placeholder="Access code" value={code} onChange={(e) => setCode(e.target.value)} />
        {error && <p className="field-hint error">{error}</p>}
        <button className="on" type="submit" disabled={!code.trim() || checking}>
          {checking ? 'Checking…' : 'Continue'}
        </button>
        <p className="muted small">Your drawings and takeoffs stay on this computer.</p>
      </form>
    </div>
  );
}
