import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * In-page replacements for window.prompt/confirm/alert, which hosted pages
 * (and some embedded browsers) silently refuse.
 */
type Request =
  | { kind: 'text'; title: string; hint?: string; initial: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'notice'; title: string; resolve: () => void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(req: Request) {
  current = req;
  emit();
}

function close() {
  current = null;
  emit();
}

export function askText(title: string, opts: { initial?: string; hint?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'text', title, hint: opts.hint, initial: opts.initial ?? '', resolve }));
}

export function askConfirm(title: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) =>
    open({ kind: 'confirm', title, confirmLabel: opts.confirmLabel ?? 'OK', danger: opts.danger ?? false, resolve }),
  );
}

export function notify(title: string): Promise<void> {
  return new Promise((resolve) => open({ kind: 'notice', title, resolve }));
}

export function DialogHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (req?.kind === 'text') {
      setValue(req.initial);
      window.setTimeout(() => input.current?.select(), 0);
    }
  }, [req]);

  if (!req) return null;

  const cancel = () => {
    close();
    if (req.kind === 'text') req.resolve(null);
    else if (req.kind === 'confirm') req.resolve(false);
    else req.resolve();
  };
  const accept = () => {
    close();
    if (req.kind === 'text') req.resolve(value);
    else if (req.kind === 'confirm') req.resolve(true);
    else req.resolve();
  };

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <form
        className="modal small"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          e.stopPropagation();
        }}
      >
        <p className="dialog-title">{req.title}</p>
        {req.kind === 'text' && (
          <>
            <input id="dialog-text" ref={input} value={value} onChange={(e) => setValue(e.target.value)} />
            {req.hint && <p className="muted">{req.hint}</p>}
          </>
        )}
        <div className="row-actions">
          <div className="spacer" />
          {req.kind !== 'notice' && (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          )}
          <button type="submit" className={req.kind === 'confirm' && req.danger ? 'danger-solid' : 'on'} autoFocus={req.kind !== 'text'}>
            {req.kind === 'confirm' ? req.confirmLabel : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
