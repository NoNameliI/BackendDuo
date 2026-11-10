import type { Ref } from 'react';
import { Markdown } from './StatementMarkdown';

export function Explanation({ text, answer, shown, headingRef }: { text: string; answer: string; shown: boolean; headingRef?: Ref<HTMLParagraphElement> }) {
  return (
    <section aria-label="Разбор" className="animate-rise rounded border border-line bg-panel p-4">
      <p ref={headingRef} tabIndex={-1} className="mb-2 outline-none font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{shown ? 'Решение показано' : 'Разбор'}</p>
      <Markdown source={text} />
      <p className="mt-3 border-t border-line pt-2 text-[13.5px]">
        Ответ: <span className="font-mono font-semibold text-ok">{answer}</span>
      </p>
    </section>
  );
}
