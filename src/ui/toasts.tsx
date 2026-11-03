import { create } from 'zustand';

export type ToastTone = 'xp' | 'badge' | 'level' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  glyph?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const LIFETIME_MS = 4000;
let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-4) }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const tones: Record<ToastTone, string> = {
  xp: 'border-ok/50 text-ok',
  badge: 'border-amber/60 text-amber',
  level: 'border-nav/60 text-nav',
  info: 'border-line-strong text-fg',
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex animate-pop items-center gap-3 rounded-md border bg-raised px-3 py-2.5 text-left shadow-lg shadow-black/30 ${tones[t.tone]}`}
        >
          {t.glyph && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-current/40 font-mono text-[11px] font-semibold">
              {t.glyph}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{t.title}</span>
            {t.body && <span className="block text-[12px] text-dim">{t.body}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
