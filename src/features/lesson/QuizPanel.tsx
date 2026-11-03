import type { ChoiceTask } from '@/content/loadCourse';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { InlineMarkdown, Markdown } from '@/ui/Markdown';
import { Panel } from '@/ui/Panel';
import { escapeHtml, highlightSql } from '@/ui/highlightSql';
import { useWorkspace } from './workspace';

export function QuizPanel({ task }: { task: ChoiceTask }) {
  const { selected, verdict, toggleOption, check } = useWorkspace();
  const multiple = task.answer.length > 1;
  const answered = verdict !== null;

  return (
    <Panel
      title={task.type === 'review' ? 'Код на ревью' : 'Вопрос'}
      actions={
        <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={() => void check()} disabled={selected.length === 0 || verdict?.passed}>
          Ответить
        </Button>
      }
    >
      <div className="h-full overflow-y-auto p-5">
        <Markdown source={task.prompt} className="mx-auto mb-5 max-w-2xl text-[16px]" />
        {task.type === 'review' && <CodeBlock code={task.code} language={task.codeLanguage} />}

        <fieldset className="mx-auto max-w-2xl">
          <legend className="mb-3 text-[13px] text-dim">
            {multiple ? 'Выберите все верные варианты' : 'Выберите один вариант'}
            <span className="text-faint"> · клавиши 1–{task.options.length}</span>
          </legend>
          <ol className="space-y-2">
            {task.options.map((option, i) => {
              const isSelected = selected.includes(i);
              const isCorrect = task.answer.includes(i);
              const tone = !answered
                ? isSelected
                  ? 'border-nav bg-nav/10'
                  : 'border-line hover:border-line-strong hover:bg-raised/60'
                : verdict.passed && isCorrect
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
                    onClick={() => toggleOption(i)}
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
      </div>
    </Panel>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const html = language === 'sql' ? highlightSql(code) : escapeHtml(code);
  const lines = html.split('\n');
  return (
    <figure className="mx-auto mb-6 max-w-2xl overflow-hidden rounded-md border border-line bg-well">
      <figcaption className="border-b border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        {language}
      </figcaption>
      <pre className="overflow-x-auto py-2 font-mono text-[13px] leading-[1.7]">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 select-none pr-3 text-right text-faint">{i + 1}</span>
            <code dangerouslySetInnerHTML={{ __html: line || ' ' }} />
          </div>
        ))}
      </pre>
    </figure>
  );
}
