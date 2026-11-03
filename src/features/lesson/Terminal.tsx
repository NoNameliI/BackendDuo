import { useEffect, useRef } from 'react';
import { useWorkspace, type LogKind } from './workspace';

const marks: Record<LogKind, { sign: string; className: string }> = {
  cmd: { sign: '❯', className: 'text-nav' },
  info: { sign: '·', className: 'text-dim' },
  ok: { sign: '✓', className: 'text-ok' },
  error: { sign: '✗', className: 'text-err' },
  hint: { sign: '?', className: 'text-amber' },
};

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function Terminal() {
  const log = useWorkspace((s) => s.log);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Вывод терминала"
      className="h-full overflow-auto bg-well px-3 py-2 font-mono text-[12.5px] leading-[1.7]"
    >
      {log.length === 0 && (
        <p className="text-faint">Ctrl+Enter — выполнить, Ctrl+Shift+Enter — проверить решение.</p>
      )}
      {log.map((entry) => {
        const mark = marks[entry.kind];
        return (
          <div key={entry.id} className="flex gap-2 animate-rise">
            <span className="shrink-0 text-faint tabular-nums">{timeFormat.format(entry.at)}</span>
            <span className={`shrink-0 ${mark.className}`}>{mark.sign}</span>
            <span className={`whitespace-pre-wrap break-words ${entry.kind === 'cmd' ? 'text-fg' : entry.kind === 'info' || entry.kind === 'hint' ? 'text-dim' : mark.className}`}>
              {entry.text}
            </span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
