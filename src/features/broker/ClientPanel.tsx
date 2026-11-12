import { lazy, Suspense } from 'react';
import { PythonStatusLine } from '@/features/api/FastapiPanel';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { useBroker } from './brokerStore';

const CodeEditor = lazy(() => import('@/features/api/CodeEditor'));

/** Client tasks: the learner's Python program (pika, confluent_kafka) on top, what it printed and how it ended below. */
export function ClientPanel({ onRun }: { onRun?: () => void }) {
  const lab = useBroker();
  const client = lab((s) => s.client);
  if (!client) return null;
  return (
    <div className="grid h-full min-h-0 grid-rows-[3fr_2fr]">
      <section aria-label="Код клиента main.py" className="flex min-h-0 flex-col border-b border-line">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
          <span className="font-mono text-[12px] text-dim">main.py</span>
          <PythonStatusLine />
          {onRun && (
            <Button className="ml-auto" variant="outline" icon={<PlayIcon />} shortcut="Ctrl ↵" disabled={client.running} onClick={onRun}>
              {client.running ? 'Выполняю…' : 'Запустить'}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <CodeEditor language="python" ariaLabel="Редактор main.py" value={client.source} onChange={lab.getState().setClientSource} onRun={onRun} />
          </Suspense>
        </div>
      </section>
      <section aria-label="Вывод программы" tabIndex={0} className="min-h-0 space-y-2 overflow-auto p-3 font-mono text-[12.5px]">
        {!client.ran && !client.running && <p className="text-dim">Запустите программу: она выполнится на том же симуляторе, что и консоль, а схема и журнал покажут её результат.</p>}
        {client.output && <pre className="m-0 whitespace-pre-wrap break-words text-fg">{client.output}</pre>}
        {client.stopped && !client.error && <p className="text-amber">Остановлено по горизонту песочницы: программа ждала дольше минуты виртуального времени (так бывает у бесконечных циклов приёма).</p>}
        {client.error && (
          <p role="alert" className="text-err">
            {client.error}
          </p>
        )}
        {client.ran && !client.error && !client.output && !client.stopped && <p className="text-dim">Программа завершилась без вывода.</p>}
      </section>
    </div>
  );
}
