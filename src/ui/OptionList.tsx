import { InlineMarkdown } from './Markdown';

/** Radio-like for single-answer questions, checkbox-like for multiple answers. */
export function toggleSelection(selected: number[], index: number, multiple: boolean): number[] {
  if (!multiple) return [index];
  return selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index];
}

interface OptionListProps {
  options: string[];
  selected: number[];
  multiple: boolean;
  onToggle: (index: number) => void;
  /** After an answer: correct options are revealed only when the answer passed. */
  verdict?: { passed: boolean; answer: number[] } | null;
}

export function OptionList({ options, selected, multiple, onToggle, verdict }: OptionListProps) {
  return (
    <fieldset>
      <legend className="mb-3 text-[13px] text-dim">
        {multiple ? 'Выберите все верные варианты' : 'Выберите один вариант'}
        <span className="text-faint"> · клавиши 1–{options.length}</span>
      </legend>
      <ol className="space-y-2">
        {options.map((option, i) => {
          const isSelected = selected.includes(i);
          const tone = !verdict
            ? isSelected
              ? 'border-nav bg-nav/10'
              : 'border-line hover:border-line-strong hover:bg-raised/60'
            : verdict.passed && verdict.answer.includes(i)
              ? 'border-ok bg-ok/10'
              : isSelected && !verdict.passed
                ? 'border-err bg-err/10'
                : 'border-line opacity-70';
          return (
            <li key={i}>
              <button
                type="button"
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={isSelected}
                onClick={() => onToggle(i)}
                className={`flex w-full items-start gap-3 rounded-md border px-3.5 py-3 text-left text-[14px] transition ${tone}`}
              >
                <span
                  className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[11px] ${
                    isSelected ? 'bg-nav text-on-accent' : 'border border-line-strong text-faint'
                  }`}
                >
                  {i + 1}
                </span>
                <InlineMarkdown source={option} />
              </button>
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
