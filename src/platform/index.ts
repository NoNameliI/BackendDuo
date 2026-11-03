// Single entry point for host-specific capabilities (persistent storage, notifications).
// The web implementation is the fallback used by `vite dev` and tests.

const STORAGE_PREFIX = 'pgstudio:';

export async function readStore<T>(key: string): Promise<T | undefined> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function writeStore(key: string, value: unknown): Promise<void> {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); progress then lives for the session only.
  }
}

export async function notify(title: string, body: string): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  new Notification(title, { body });
  return true;
}
