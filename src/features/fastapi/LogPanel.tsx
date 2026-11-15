import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Panel';

export interface LogLine {
  id: number;
  kind: 'load' | 'access' | 'output' | 'error';
  text: string;
}

const TONE: Record<LogLine['kind'], string> = {
  load: 'text-dim',
  access: 'text-faint',
  output: 'text-fg',
  error: 'text-amber',
};

/** What the app wrote: its own output as it ran, with the access lines the studio adds for every request. */
export function LogPanel({ lines, onClear }: { lines: LogLine[]; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <p className="min-w-0 text-[12px] text-faint">Строки INFO записывает студия, а не uvicorn: учебное приложение запущено без сервера.</p>
        <Button className="ml-auto shrink-0" variant="outline" onClick={onClear} disabled={lines.length === 0}>
          Очистить
        </Button>
      </header>
      <div role="region" aria-label="Строки лога" tabIndex={0} data-audit-allow="bad-wrap" className="min-h-0 flex-1 overflow-auto">
        {lines.length === 0 ? (
          <EmptyState>Лог пуст. Отправьте запрос: здесь появятся его строка INFO и всё, что приложение напечатало.</EmptyState>
        ) : (
          <div role="log" aria-label="Лог приложения" className="p-3 font-mono text-[12.5px] leading-relaxed">
            {lines.map((l) => (
              <pre key={l.id} className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${TONE[l.kind]}`}>
                {l.text}
              </pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
