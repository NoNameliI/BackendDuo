import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, tabs, actions, children }: PanelProps) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line pl-3 pr-1.5">
        {title && <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{title}</h2>}
        {tabs}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-faint">{children}</div>;
}
