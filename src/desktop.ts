import type { FolderApi } from './folderSync';

/** The desktop app's extras (electron/preload.cjs). */
export interface DesktopApi extends FolderApi {
  platform: string;
  revealProject(dir: string): Promise<void>;
  /** Where projects go by default: iCloud Drive › Takeoff AI when iCloud Drive is set up. */
  getDefaultFolder(): Promise<{ path: string; iCloud: boolean }>;
  useDefaultFolder(): Promise<string>;
  /** A folder chosen before that can't be found now. */
  getMissingFolder(): Promise<string | null>;
  /** Runs `finish` when the window is closing; the window waits for it. */
  onFlush(finish: () => Promise<void>): void;
}

/** The desktop app's extras, or null in a browser. */
export const desktopApi: DesktopApi | null = (globalThis as { takeoffDesktop?: DesktopApi }).takeoffDesktop ?? null;

/** A projects folder path as people know it: "iCloud Drive › Takeoff AI". */
export function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const cloud = parts.findIndex((p) => p === 'com~apple~CloudDocs' || p === 'iCloudDrive');
  if (cloud >= 0) return ['iCloud Drive', ...parts.slice(cloud + 1)].join(' › ');
  return parts.slice(-2).join(' › ');
}
