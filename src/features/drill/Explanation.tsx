import { Markdown } from './StatementMarkdown';

export function Explanation({ text, answer, shown }: { text: string; answer: string; shown: boolean }) {
  return (
    <section aria-label="Разбор" className="animate-rise rounded border border-line bg-panel p-4">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{shown ? 'Решение показано' : 'Разбор'}</p>
      <Markdown source={text} />
      <p className="mt-3 border-t border-line pt-2 text-[13.5px]">
        Ответ: <span className="font-mono font-semibold text-ok">{answer}</span>
      </p>
    </section>
  );
}
