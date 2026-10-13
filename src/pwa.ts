import { isHosted } from './host';

/**
 * Installing and updating the app when it is served from an ordinary web host
 * (not inside a claude.ai artifact, where service workers are not allowed).
 */
export const canUseServiceWorker = () =>
  !isHosted && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && import.meta.env.PROD;

/**
 * Registers the service worker that keeps the app working offline. `onUpdate` is
 * called when a new version has downloaded; calling the function it receives
 * switches to it and reloads.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!canUseServiceWorker()) return;
  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const offer = (worker: ServiceWorker) =>
        onUpdate(() => {
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          worker.postMessage('update-now');
        });
      // A version that finished downloading while the app was closed.
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      // Check for a new version every half hour while the app stays open.
      window.setInterval(() => void reg.update().catch(() => {}), 30 * 60 * 1000);
    } catch {
      // Offline use is a bonus; the app works without it.
    }
  };
  // Register after the page has loaded so it does not compete with the first paint.
  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => void start(), { once: true });
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
});

/** True when the app already runs as an installed app. */
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/**
 * Offers to install the app. Chrome and Edge show their own prompt; elsewhere the
 * result says how to do it from the browser's menu.
 */
export async function promptInstall(): Promise<'installed' | 'dismissed' | 'manual'> {
  if (!installPrompt) return 'manual';
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome === 'accepted' ? 'installed' : 'dismissed';
}

/** Files the installed app was opened with (double-clicking a .takeoff file or a PDF in Finder). */
export function onLaunchFiles(handle: (files: File[]) => void): void {
  const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    handle(await Promise.all(files.map((f) => f.getFile())));
  });
}
