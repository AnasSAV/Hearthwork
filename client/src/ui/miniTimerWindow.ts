import { uiStore } from '../store';

/** Chromium's Document Picture-in-Picture; not in TypeScript's DOM types yet. */
interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
const pipApi = (): DocumentPip | null =>
  (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ??
  null;

/** Only desktop Chrome and Edge can keep a small window on top of other apps. */
export const miniTimerSupported = (): boolean => pipApi() !== null;

/** Must be called from a click: browsers only open this window on a user gesture. */
export async function openMiniTimer(): Promise<void> {
  const api = pipApi();
  if (!api || uiStore.get().miniTimer) return;
  try {
    const win = await api.requestWindow({ width: 240, height: 300 });
    // It starts as a blank document: bring over the game's fonts and styles.
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      win.document.head.append(node.cloneNode(true));
    }
    win.document.title = 'Hearthwork';
    win.document.body.className = 'mini-timer-body';
    win.addEventListener('pagehide', () => uiStore.set({ miniTimer: null }));
    uiStore.set({ miniTimer: win });
  } catch {
    // Refused or unavailable: the timer keeps running in the main window anyway.
  }
}
