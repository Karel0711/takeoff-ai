import { del, get, set } from 'idb-keyval';
import type { Project } from './model';

/** Everything stays in this browser's IndexedDB; nothing leaves the machine. */
const PROJECT_KEY = 'project';
const pdfKey = (docId: string) => `pdf:${docId}`;

export const loadProject = (): Promise<Project | undefined> => get<Project>(PROJECT_KEY);
export const saveProject = (project: Project): Promise<void> => set(PROJECT_KEY, project);

export const loadPdf = (docId: string): Promise<ArrayBuffer | undefined> => get<ArrayBuffer>(pdfKey(docId));
export const savePdf = (docId: string, data: ArrayBuffer): Promise<void> => set(pdfKey(docId), data);
export const deletePdf = (docId: string): Promise<void> => del(pdfKey(docId));
