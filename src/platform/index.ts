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

/**
 * Saves a text export. Desktop: straight into the Downloads folder under a safe, never-overwriting name
 * (the Rust side validates `name`); returns the full path. Web: a browser download; the path is unknown (null).
 */
export async function saveTextFile(name: string, text: string): Promise<{ path: string | null }> {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return { path: await invoke<string>('save_export', { name, text }) };
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { path: null };
}
