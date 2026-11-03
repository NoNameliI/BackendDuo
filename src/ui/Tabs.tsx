import { useRef, type KeyboardEvent } from 'react';

interface TabsProps<T extends string> {
  label: string;
  items: readonly { id: T; title: string }[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}

export function Tabs<T extends string>({ label, items, value, onChange, idPrefix }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const index = items.findIndex((t) => t.id === value);
    const next = items[(index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    onChange(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${next.id}`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className="flex h-full items-stretch gap-4" onKeyDown={onKeyDown}>
      {items.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`relative font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              selected ? 'text-fg' : 'text-faint hover:text-dim'
            }`}
          >
            {tab.title}
            <span
              className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-colors ${selected ? 'bg-amber' : 'bg-transparent'}`}
            />
          </button>
        );
      })}
    </div>
  );
}
