import { useEffect, useState } from 'react';
import type { Units } from '../model';
import { listProjects, storageEstimate, type ProjectSummary } from '../storage';
import { Icon } from './Icons';

interface Props {
  currentId: string | undefined;
  persisted: boolean;
  onOpen: (id: string) => void;
  onNew: (units: Units) => void;
  onDelete: (id: string) => void;
  onSaveFile: () => void;
  onOpenFile: () => void;
  onBackupAll: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

const size = (bytes: number) =>
  bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes > 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

/** Every project saved in this browser, with new, open, delete and project files. */
export function ProjectsPanel({ currentId, persisted, onOpen, onNew, onDelete, onSaveFile, onOpenFile, onBackupAll }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void listProjects().then((l) => setProjects([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
    void storageEstimate().then(setSpace);
  }, []);

  return (
    <div className="projects-panel">
      <div className="pop-head">
        <div className="pop-title">Projects</div>
        <div className="pop-sub">Saved in this browser on this computer{persisted ? ', kept until you delete them' : ''}.</div>
      </div>
      <ul className="project-list">
        {projects === null && <li className="muted project-empty">Loading…</li>}
        {projects?.length === 0 && <li className="muted project-empty">No saved projects yet.</li>}
        {projects?.map((p) => (
          <li key={p.id} className={p.id === currentId ? 'current' : ''}>
            <button className="project-row" onClick={() => onOpen(p.id)} disabled={p.id === currentId}>
              <span className="project-name-cell">
                <span className="project-title">{p.name || 'Untitled project'}</span>
                <span className="project-meta">
                  {when(p.updatedAt)} · {p.sheets} sheet{p.sheets === 1 ? '' : 's'} · {p.takeoffs} takeoff{p.takeoffs === 1 ? '' : 's'} ·{' '}
                  {p.units === 'metric' ? 'metric' : 'imperial'}
                </span>
              </span>
              {p.id === currentId && <span className="open-badge">Open</span>}
            </button>
            <button className="icon-button small danger" title="Delete project" aria-label={`Delete ${p.name}`} onClick={() => onDelete(p.id)}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="pop-section">
        <div className="button-row">
          <button onClick={() => onNew('metric')}>
            <Icon name="plus" size={14} /> New metric
          </button>
          <button onClick={() => onNew('imperial')}>
            <Icon name="plus" size={14} /> New imperial
          </button>
        </div>
      </div>
      <div className="pop-section">
        <div className="pop-label">Project files</div>
        <div className="button-row">
          <button onClick={onSaveFile} title="Save this project, its history and drawings as one file">
            <Icon name="download" size={14} /> Save to file…
          </button>
          <button onClick={onOpenFile} title="Open a .takeoff file as a new project">
            <Icon name="upload" size={14} /> Open file…
          </button>
        </div>
        <p className="field-hint">A .takeoff file holds the whole project with its drawings: use it for backups or to move a takeoff to another computer.</p>
        <div className="button-row">
          <button onClick={onBackupAll} title="Every project, with its history and drawings, in one file">
            <Icon name="download" size={14} /> Back up all projects…
          </button>
        </div>
        <p className="field-hint">Open a backup with Open file… to restore every project in it.</p>
      </div>
      {space && (
        <div className="pop-actions storage-line">
          <span>
            Using {size(space.usage)} of {size(space.quota)}
          </span>
        </div>
      )}
    </div>
  );
}
