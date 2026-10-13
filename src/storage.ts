import { del, get, set } from 'idb-keyval';
import type { ActivityEvent } from './activity';
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

/**
 * The activity log: every takeoff, type and sheet change, kept beside the project so
 * the project record stays small. Capped at the most recent 20,000 changes.
 */
const ACTIVITY_KEY = 'activity';
const ACTIVITY_CAP = 20000;
export const loadActivity = () => safely(async () => (await get<ActivityEvent[]>(ACTIVITY_KEY)) ?? [], [] as ActivityEvent[]);
export const saveActivity = (events: ActivityEvent[]) => safely(() => set(ACTIVITY_KEY, events.slice(-ACTIVITY_CAP)), undefined);
