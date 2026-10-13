import type { FolderApi } from './folderSync';

/** The desktop app's extras (electron/preload.cjs), or null in a browser. */
export const desktopApi: (FolderApi & { platform: string }) | null =
  (globalThis as { takeoffDesktop?: FolderApi & { platform: string } }).takeoffDesktop ?? null;

/** A projects folder path as people know it: "iCloud Drive › Takeoff AI". */
export function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const cloud = parts.findIndex((p) => p === 'com~apple~CloudDocs' || p === 'iCloudDrive');
  if (cloud >= 0) return ['iCloud Drive', ...parts.slice(cloud + 1)].join(' › ');
  return parts.slice(-2).join(' › ');
}
