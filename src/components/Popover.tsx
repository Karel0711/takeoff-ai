import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Line the popover up with the anchor's left or right edge. */
  align?: 'start' | 'end';
  width?: number;
  label: string;
}

/** A panel that drops down from a toolbar button, like a macOS popover. Closes on Esc or a click outside. */
export function Popover({ anchor, onClose, children, align = 'start', width = 320, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 24);
      const left = align === 'end' ? r.right - w : r.left;
      setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(left, window.innerWidth - w - 12)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, align, width]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label={label}
      style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 24) }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** A dropdown menu of commands, separated into groups. */
export function Menu({ anchor, onClose, groups, label }: { anchor: RefObject<HTMLElement | null>; onClose: () => void; groups: MenuItem[][]; label: string }) {
  return (
    <Popover anchor={anchor} onClose={onClose} align="end" width={320} label={label}>
      <div className="menu" role="menu">
        {groups.map((g, i) => (
          <div className="menu-group" key={i}>
            {g.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  );
}
