import { useEffect } from 'react';

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Add your drawings',
    text: 'Add drawings (top right) takes a PDF set. Each page becomes a sheet on the left, named and scaled from its title block.',
  },
  {
    title: 'Check the scale',
    text: 'The scale pill at the top checks the scale against the sheet’s dimensions. Change it there if it asks you to.',
  },
  {
    title: 'Pick a type, then measure',
    text: 'Types on the left are what you price; + adds your own or your trade’s from the library. Measure (M) draws, Fill (R) takes a room in one click, Symbols (S) counts every copy of a symbol you box.',
  },
  {
    title: 'Let Automate do the rest',
    text: 'Automate takes off every tagged wall and room, counts door tags, reads legends and finish schedules, and finds every area hatched like one you pick.',
  },
  {
    title: 'Check, fix, export',
    text: 'Select a takeoff to change or delete it, or Box select (B) several at once; ⌘Z undoes anything. Export makes the Excel workbook or a marked-up PDF for your quote.',
  },
  {
    title: 'Your work stays here',
    text: 'Projects save on this computer as you work. More › Save project to file makes a copy you can keep or send.',
  },
];

/** A one-page guide for someone opening the app for the first time. */
export function QuickStartDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Quick start" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Quick start</h3>
          <button onClick={onClose} autoFocus>
            Done
          </button>
        </div>
        <ol className="quick-start">
          {STEPS.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="field-hint build-line">Version {__BUILD__}</p>
      </div>
    </div>
  );
}
