import { Children, Fragment, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { loadSizes, resizePair, saveSizes } from './splitSizes';

interface SplitProps {
  direction: 'row' | 'column';
  initial: number[];
  storageKey: string;
  min?: number;
  children: ReactNode;
}

const KEY_STEP = 2;

export function Split({ direction, initial, storageKey, min = 15, children }: SplitProps) {
  const panes = Children.toArray(children);
  const [sizes, setSizes] = useState(() => loadSizes(storageKey, initial));
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const containerRef = useRef<HTMLDivElement>(null);
  const row = direction === 'row';

  const startDrag = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || e.button !== 0) return;
    const rect = container.getBoundingClientRect();
    const total = row ? rect.width : rect.height;
    const origin = row ? e.clientX : e.clientY;
    const base = sizesRef.current;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.dataset.dragging = 'true';

    const onMove = (ev: globalThis.PointerEvent) => {
      const pos = row ? ev.clientX : ev.clientY;
      setSizes(resizePair(base, index, ((pos - origin) / total) * 100, min));
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      delete handle.dataset.dragging;
      saveSizes(storageKey, sizesRef.current);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  const onKey = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const back = row ? 'ArrowLeft' : 'ArrowUp';
    const forward = row ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== forward) return;
    e.preventDefault();
    const next = resizePair(sizesRef.current, index, e.key === back ? -KEY_STEP : KEY_STEP, min);
    setSizes(next);
    saveSizes(storageKey, next);
  };

  return (
    <div ref={containerRef} className={`flex h-full min-h-0 w-full min-w-0 ${row ? 'flex-row' : 'flex-col'}`}>
      {panes.map((pane, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={row ? 'vertical' : 'horizontal'}
              aria-valuenow={Math.round(sizes[i - 1])}
              aria-valuemin={min}
              aria-valuemax={100 - min}
              aria-label="Изменить размер панелей"
              tabIndex={0}
              onPointerDown={startDrag(i - 1)}
              onKeyDown={onKey(i - 1)}
              className={`group relative shrink-0 touch-none outline-none ${row ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'}`}
            >
              <span
                className={`absolute rounded-full bg-transparent transition-colors group-hover:bg-line-strong group-focus-visible:bg-nav group-data-[dragging]:bg-nav ${
                  row ? 'inset-y-2 left-1/2 w-px -translate-x-1/2' : 'inset-x-2 top-1/2 h-px -translate-y-1/2'
                }`}
              />
            </div>
          )}
          <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${sizes[i]} 1 0px` }}>
            {pane}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
