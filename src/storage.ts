import { del, get, set } from 'idb-keyval';
import type { Project } from './model';

/** Everything stays in this browser's IndexedDB; nothing leaves the machine. */
const PROJECT_KEY = 'project';
const pdfKey = (docId: string) => `pdf:${docId}`;

// Storage can be unavailable (private windows, blocked site data, previews). The app then
// works for the current visit and simply starts fresh next time.
const safely = async <T>(op: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await op();
  } catch {
    return fallback;
  }
};

export const loadProject = () => safely(() => get<Project>(PROJECT_KEY), undefined);
export const saveProject = (project: Project) => safely(() => set(PROJECT_KEY, project), undefined);

export const loadPdf = (docId: string) => safely(() => get<ArrayBuffer>(pdfKey(docId)), undefined);
export const savePdf = (docId: string, data: ArrayBuffer) => safely(() => set(pdfKey(docId), data), undefined);
export const deletePdf = (docId: string) => safely(() => del(pdfKey(docId)), undefined);
