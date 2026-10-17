import type { Project } from '../model';

/**
 * What an automation found: the change it makes to the project (applied as one undoable
 * change in the app, straight to the project in the benchmark) and what to tell the user.
 * Without `apply`, nothing was found and `message` says why.
 */
export type Automation = { message: string; apply?: (p: Project) => Project };
