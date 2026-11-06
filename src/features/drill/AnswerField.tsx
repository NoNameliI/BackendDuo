import { useId, type KeyboardEvent } from 'react';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import type { Problem } from './drillStore';

const PROBLEMS: Record<Problem, string> = {
  empty: 'Введите ответ.',
  format: 'Не удалось разобрать ответ: проверьте формат (например, число без лишних знаков).',
};

interface AnswerFieldProps {
  value: string;
  onChange: (text: string) => void;
  onCheck?: () => void;
  disabled?: boolean;
  problem?: Problem | null;
  label?: string;
  /** Verdict text announced politely (not for sets). */
  verdict?: { tone: 'ok' | 'err' | 'info'; text: string } | null;
}

export function AnswerField({ value, onChange, onCheck, disabled, problem, label = 'Ответ', verdict }: AnswerFieldProps) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && onCheck) {
      e.preventDefault();
      onCheck();
    }
  };
  const tones = { ok: 'text-ok', err: 'text-err', info: 'text-dim' };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={id} className="mb-1 block font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            {label}
          </label>
          <input
            id={id}
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 w-full rounded border border-line-strong bg-well px-3 font-mono text-[15px] outline-none focus:border-nav disabled:opacity-60"
          />
        </div>
        {onCheck && (
          <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" disabled={disabled} onClick={onCheck} className="!h-9">
            Проверить
          </Button>
        )}
      </div>
      <div id={`${id}-problem`} role="alert" className="min-h-0 text-[12.5px] text-amber">
        {problem ? PROBLEMS[problem] : null}
      </div>
      {onCheck && (
        <div role="status" className={`min-h-[1.25rem] text-[13px] font-medium ${verdict ? tones[verdict.tone] : ''}`}>
          {verdict?.text}
        </div>
      )}
    </div>
  );
}
