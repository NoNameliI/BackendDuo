import { Button } from '@/ui/Button';
import { Markdown } from './StatementMarkdown';

/** Three hints, one at a time; every one opened lowers the reward. */
export function HintLadder({ hints, shown, onReveal, disabled }: { hints: string[]; shown: number; onReveal: () => void; disabled?: boolean }) {
  return (
    <section aria-label="Подсказки" className="space-y-2">
      {shown > 0 && (
        <ol className="space-y-2">
          {hints.slice(0, shown).map((hint, i) => (
            <li key={i} className="animate-rise rounded border border-line bg-well px-3 py-2 text-[13.5px]">
              <span className="mb-0.5 block font-mono text-[10.5px] uppercase tracking-[0.14em] text-amber">Подсказка {i + 1}</span>
              <Markdown source={hint} />
            </li>
          ))}
        </ol>
      )}
      {shown < hints.length && (
        <Button variant="outline" disabled={disabled} onClick={onReveal}>
          Подсказка {shown + 1} из {hints.length}
        </Button>
      )}
    </section>
  );
}
