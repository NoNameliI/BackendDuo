// Single entry point for host-specific capabilities: persistent storage, notifications, window chrome.
// Inside the desktop shell they go through Tauri plugins; in a plain browser (`vite dev`, tests)
// the web fallbacks are used. Tauri modules are imported lazily so the web bundle stays lean.
import type { Store } from '@tauri-apps/plugin-store';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const STORAGE_PREFIX = 'pgstudio:';
const STORE_FILE = 'studio.json';

let store: Promise<Store> | null = null;
const desktopStore = () =>
  (store ??= import('@tauri-apps/plugin-store').then(({ load }) => load(STORE_FILE, { autoSave: 300, defaults: {} })));

export async function readStore<T>(key: string): Promise<T | undefined> {
  try {
    if (isDesktop) return (await (await desktopStore()).get<T>(key)) ?? undefined;
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function writeStore(key: string, value: unknown): Promise<void> {
  try {
    if (isDesktop) await (await desktopStore()).set(key, value);
    else localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); progress then lives for the session only.
  }
}

/** Shows a system notification, asking for permission first if needed. Returns false when not allowed. */
export async function notify(title: string, body: string): Promise<boolean> {
  if (isDesktop) {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (granted) n.sendNotification({ title, body });
    return granted;
  }
  if (typeof Notification === 'undefined') return false;
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  new Notification(title, { body });
  return true;
}

/** Keeps the native title bar in step with the app theme (desktop only). */
export async function setWindowTheme(theme: 'dark' | 'light'): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTheme(theme);
}
