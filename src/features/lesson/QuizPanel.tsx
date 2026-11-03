import type { ChoiceTask } from '@/content/loadCourse';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { OptionList } from '@/ui/OptionList';
import { Panel } from '@/ui/Panel';
import { escapeHtml, highlightSql } from '@/ui/highlightSql';
import { useWorkspace } from './workspace';

export function QuizPanel({ task }: { task: ChoiceTask }) {
  const { selected, verdict, toggleOption, check } = useWorkspace();

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
        <div className="mx-auto max-w-2xl">
          <Markdown source={task.prompt} className="mb-5 text-[16px]" />
          {task.type === 'review' && <CodeBlock code={task.code} language={task.codeLanguage} />}
          <OptionList
            options={task.options}
            selected={selected}
            multiple={task.answer.length > 1}
            onToggle={toggleOption}
            verdict={verdict ? { passed: verdict.passed, answer: task.answer } : null}
          />
        </div>
      </div>
    </Panel>
  );
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const html = language === 'sql' ? highlightSql(code) : escapeHtml(code);
  const lines = html.split('\n');
  return (
    <figure className="mb-6 overflow-hidden rounded-md border border-line bg-well">
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
