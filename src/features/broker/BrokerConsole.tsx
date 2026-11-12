import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useBroker } from './brokerStore';

const TOP = ['rabbitmqadmin', 'rabbitmqctl', 'lq', 'sim', 'help', 'history', 'clear'];
const WORDS: Record<string, string[]> = {
  rabbitmqadmin: ['exchanges', 'queues', 'bindings', 'publish', 'get'],
  'rabbitmqadmin exchanges': ['declare', 'delete', 'list'],
  'rabbitmqadmin queues': ['declare', 'delete', 'list', 'purge'],
  'rabbitmqadmin bindings': ['declare', 'delete', 'list'],
  'rabbitmqadmin publish': ['message'],
  'rabbitmqadmin get': ['messages'],
  rabbitmqctl: ['list_queues', 'list_exchanges', 'list_bindings', 'list_consumers', 'list_vhosts', 'list_users', 'add_vhost', 'delete_vhost', 'add_user', 'set_permissions', 'purge_queue', 'delete_queue'],
  sim: ['consume', 'ack', 'nack', 'reject', 'run', 'restart', 'as'],
};
const FLAGS = [
  '--name', '--type', '--durable', '--auto-delete', '--source', '--destination-type', '--destination', '--routing-key', '--arguments',
  '--payload', '--exchange', '--queue', '--count', '--ack-mode', '--properties', '--columns', '--idempotently', '--vhost',
  '--non-interactive', '--prefetch', '--auto-ack', '--multiple', '--requeue',
];
const NAME_FLAGS = new Set(['--name', '--queue', '--source', '--destination']);

function tone(t: 'out' | 'err' | 'dim'): string {
  return t === 'err' ? 'text-err' : t === 'dim' ? 'text-dim' : 'text-fg';
}

function commonPrefix(xs: string[]): string {
  let p = xs[0] ?? '';
  for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** Command line of the broker lab: history on ↑/↓, Tab completion, Ctrl+L to clear; modelled on the Git terminal. */
export function BrokerConsole() {
  const lab = useBroker();
  const entries = lab((s) => s.entries);
  const history = lab((s) => s.history);
  const input = lab((s) => s.draft);
  const starter = lab((s) => s.spec?.starter ?? '');
  const setInput = lab((s) => s.setDraft);
  const [cursor, setCursor] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.at(-1)?.id, suggestions]);

  const submit = () => {
    lab.getState().run(input);
    setInput('');
    setCursor(null);
    setSuggestions([]);
  };

  const browse = (step: -1 | 1) => {
    if (!history.length) return;
    const next = Math.min(history.length, Math.max(0, (cursor ?? history.length) + step));
    setCursor(next === history.length ? null : next);
    setInput(next === history.length ? '' : history[next]);
  };

  const complete = () => {
    const words = input.split(/\s+/);
    const last = words.at(-1) ?? '';
    const before = words.slice(0, -1);
    let pool: string[];
    if (before.length === 0) pool = TOP;
    else if (NAME_FLAGS.has(before.at(-1)!)) {
      const snap = lab.getState().view().snapshot;
      pool = snap.vhosts.flatMap((v) => [...v.queues.map((q) => q.name), ...v.exchanges.map((e) => e.name)]).filter(Boolean);
    } else if (last.startsWith('-')) pool = FLAGS;
    else pool = WORDS[before.slice(0, 2).join(' ')] ?? WORDS[before[0]] ?? [];
    const found = [...new Set(pool)].filter((w) => w.startsWith(last)).sort();
    if (!found.length) return;
    const head = input.slice(0, input.length - last.length);
    const common = commonPrefix(found);
    setInput(`${head}${common}${found.length === 1 ? ' ' : ''}`);
    setSuggestions(found.length > 1 ? found : []);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const single = !input.includes('\n');
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' && single) {
      e.preventDefault();
      browse(-1);
    } else if (e.key === 'ArrowDown' && single) {
      e.preventDefault();
      browse(1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      lab.getState().clearConsole();
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      e.preventDefault();
      setInput('');
      setSuggestions([]);
    }
  };

  return (
    <div
      className="h-full overflow-y-auto bg-well px-3 py-2 font-mono text-[12.5px] leading-[1.6]"
      onMouseUp={() => {
        if (!window.getSelection()?.toString()) areaRef.current?.focus();
      }}
    >
      <div role="log" aria-live="polite" aria-label="Вывод консоли">
        {entries.length === 0 && (
          <p className="pb-1 text-dim">
            Учебная песочница: команды rabbitmqadmin (v2), rabbitmqctl и учебные sim … выполняются в модели внутри приложения. Tab — дополнить, ↑/↓ — история, Ctrl+L — очистить, help — список команд.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id}>
            {entry.command && (
              <p className="whitespace-pre-wrap break-words">
                <span className="text-ok">$</span> <span className="text-fg">{entry.command}</span>
              </p>
            )}
            {entry.lines.map((line, i) => (
              <p key={i} className={`min-h-[1.6em] whitespace-pre-wrap break-words ${tone(line.tone)}`}>
                {line.text}
              </p>
            ))}
          </div>
        ))}
      </div>
      {starter.trim() && input !== starter && (
        <button type="button" onClick={() => setInput(starter)} className="mb-1 h-6 rounded border border-line-strong px-2 font-sans text-[12px] text-dim hover:border-faint hover:text-fg">
          Вставить заготовку задания
        </button>
      )}
      <label className="flex items-baseline gap-2">
        <span className="shrink-0 text-ok">$</span>
        <textarea
          ref={areaRef}
          value={input}
          rows={Math.min(8, input.split('\n').length)}
          onChange={(e) => {
            setInput(e.target.value);
            setSuggestions([]);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Команда"
          className="min-w-0 flex-1 resize-none bg-transparent text-fg caret-ok outline-none"
        />
      </label>
      {suggestions.length > 1 && <p className="whitespace-pre-wrap text-dim">{suggestions.join('  ')}</p>}
      <div ref={endRef} />
    </div>
  );
}
