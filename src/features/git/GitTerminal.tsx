import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { commonPrefix, completions, prompt } from '@/engine/git/complete';
import type { OutputLine } from '@/engine/git/shell';
import { useSandbox } from './gitSandbox';

/** git prints progress and advice to stderr too; only real errors are red. */
function tone(line: OutputLine): string {
  const text = line.text;
  if (/^(remote: )?(fatal|error)\b|^CONFLICT|\[(remote )?rejected\]/.test(text)) return 'text-err';
  if (line.stream === 'out') return 'text-dim';
  if (text.startsWith('hint:')) return 'text-amber';
  // Errors of other tools: "bash: x: command not found", "grep: f: No such file or directory".
  return /^(?!remote:|hint:|warning:)[a-z]+: /.test(text) ? 'text-err' : 'text-dim';
}

/** Command line of the Git sandbox: prompt, history on ↑/↓, Tab completion, Ctrl+L to clear. */
export function GitTerminal() {
  const useGitSandbox = useSandbox();
  const entries = useGitSandbox((s) => s.entries);
  const engine = useGitSandbox((s) => s.engine);
  useGitSandbox((s) => s.version);
  const run = useGitSandbox((s) => s.run);
  const history = useGitSandbox((s) => s.history);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.at(-1)?.id, suggestions]);

  const submit = () => {
    run(input);
    setInput('');
    setCursor(null);
    setSuggestions([]);
  };

  const browse = (step: -1 | 1) => {
    if (!history.length) return;
    const from = cursor ?? history.length;
    const next = Math.min(history.length, Math.max(0, from + step));
    setCursor(next === history.length ? null : next);
    setInput(next === history.length ? '' : history[next]);
  };

  const complete = () => {
    const candidates = completions(engine.world, input);
    if (!candidates.length) return;
    const head = input.slice(0, input.length - (input.split(/\s+/).at(-1)?.length ?? 0));
    const common = commonPrefix(candidates);
    if (candidates.length === 1) {
      setInput(`${head}${common}${common.endsWith('/') ? '' : ' '}`);
      setSuggestions([]);
    } else {
      setInput(`${head}${common}`);
      setSuggestions(candidates);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      browse(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      browse(1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      run('clear');
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      e.preventDefault();
      setInput('');
      setSuggestions([]);
    }
  };

  return (
    <div
      className="h-full overflow-auto bg-well px-3 py-2 font-mono text-[12.5px] leading-[1.6]"
      onMouseUp={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus();
      }}
    >
      <div role="log" aria-live="polite" aria-label="Вывод терминала">
        {entries.length === 0 && (
          <p className="pb-1 text-faint">
            Учебная песочница: команды выполняются в модели внутри приложения и не затрагивают ваши файлы. Tab — дополнить,
            ↑/↓ — история, Ctrl+L — очистить.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id}>
            <p className="whitespace-pre-wrap break-words">
              <span className="text-ok">{entry.prompt}</span> <span className="text-fg">{entry.command}</span>
            </p>
            {entry.lines.map((line, i) => (
              <p key={i} className={`min-h-[1.6em] whitespace-pre-wrap break-words ${tone(line)}`}>
                {line.text}
              </p>
            ))}
            {entry.hint && <p className="whitespace-pre-wrap text-amber">Подсказка: {entry.hint}</p>}
          </div>
        ))}
      </div>
      <label className="flex items-baseline gap-2">
        <span className="shrink-0 text-ok">{prompt(engine.world)}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSuggestions([]);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Команда"
          className="min-w-0 flex-1 bg-transparent text-fg caret-ok outline-none"
        />
      </label>
      {suggestions.length > 1 && <p className="whitespace-pre-wrap text-faint">{suggestions.join('  ')}</p>}
      <div ref={endRef} />
    </div>
  );
}
