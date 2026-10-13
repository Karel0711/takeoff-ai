import { useEffect } from 'react';

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Add your drawings',
    text: 'Add drawings (top right) takes a PDF set. Every page becomes a sheet on the left, named from its title block, with its scale read from the sheet. The search box finds sheets and any text on them (a room name, a tag).',
  },
  {
    title: 'Check the scale',
    text: 'Click the scale pill at the top. It checks the scale against the sheet’s own dimensions; pick another scale or calibrate from a dimension if it says so.',
  },
  {
    title: 'Pick a takeoff type, then a tool',
    text: 'Types on the left are what you price (walls, floors, ceilings, doors); + adds a blank one or ready-made ones for your trade from the library. Measure (M) draws by hand; Fill (R) takes a room’s area in one click; Trace (T) measures a drawn line’s whole run; Symbols (S) counts every copy of a symbol you box.',
  },
  {
    title: 'Let Automate do the repetitive part',
    text: 'Automate reads the assembly legend into types, takes off every tagged wall, fills every tagged room, counts door tags, sets room finishes, and turns a boxed symbols legend into types with every symbol counted. Select a hatched ceiling or floor area and choose Find areas hatched like this for the rest.',
  },
  {
    title: 'Fix anything by hand',
    text: 'Select a takeoff to change its type, rename it, drag its points or delete it. Every change can be undone (⌘Z) and is listed under History.',
  },
  {
    title: 'Export and keep your work',
    text: 'Export makes the Excel workbook, or a marked-up PDF of the drawings with your takeoffs to attach to a quote. A typical floor drawn once can count for several (More › Count this sheet more than once). Projects are saved on this computer as you work; Projects › Save to file or Back up all projects makes files you can keep or move to another computer.',
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
