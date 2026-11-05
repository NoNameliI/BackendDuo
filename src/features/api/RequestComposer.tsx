import { useEffect, useState } from 'react';
import { formatRequest, METHODS, splitUrl, withQuery, type HttpHeader } from '@/engine/api/http';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';

type Tab = 'params' | 'headers' | 'body' | 'text';
const TABS = [
  { id: 'params', title: 'Params' },
  { id: 'headers', title: 'Headers' },
  { id: 'body', title: 'Body' },
  { id: 'text', title: 'Как текст' },
] as const;

const input = 'rounded border border-line bg-well px-2 py-1 font-mono text-[12.5px] text-fg outline-none focus:border-nav';

/** Editable list of name/value pairs: query parameters or headers. */
function PairsEditor({ pairs, onChange, label, namePlaceholder }: { pairs: HttpHeader[]; onChange: (pairs: HttpHeader[]) => void; label: string; namePlaceholder: string }) {
  const rows = [...pairs, { name: '', value: '' }];
  const update = (i: number, patch: Partial<HttpHeader>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r)).filter((r, j) => j < pairs.length || r.name || r.value);
    onChange(next.filter((r, j) => r.name || r.value || j < pairs.length - 1 || j === i));
  };
  return (
    <table className="w-full border-separate border-spacing-y-1 text-[12.5px]" aria-label={label}>
      <thead className="text-left font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        <tr>
          <th className="w-[40%] font-normal">Имя</th>
          <th className="font-normal">Значение</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="pr-2">
              <input aria-label={`${label}: имя ${i + 1}`} className={`${input} w-full`} placeholder={namePlaceholder} value={row.name} onChange={(e) => update(i, { name: e.target.value })} />
            </td>
            <td className="pr-2">
              <input aria-label={`${label}: значение ${i + 1}`} className={`${input} w-full`} value={row.value} onChange={(e) => update(i, { value: e.target.value })} />
            </td>
            <td>
              {i < pairs.length && (
                <button type="button" aria-label={`Удалить строку ${i + 1}`} className="px-1 text-faint hover:text-err" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Request composer: method, URL, query parameters, headers, body — or the whole request as text. */
export function RequestComposer({ onSend }: { onSend?: () => void }) {
  const useStore = useApiSandbox();
  const draft = useStore((s) => s.draft);
  const sending = useStore((s) => s.sending);
  const baseUrl = useStore((s) => s.baseUrl);
  const setDraft = useStore((s) => s.setDraft);
  const setDraftText = useStore((s) => s.setDraftText);
  const send = useStore((s) => s.send);
  const [tab, setTab] = useState<Tab>('params');
  const [text, setText] = useState(() => formatRequest(draft));
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'text') setText(formatRequest(draft));
  }, [draft, tab]);

  const query = splitUrl(draft.url).query.map(([name, value]) => ({ name, value }));
  const submit = () => {
    if (tab === 'text' && textError) return;
    void send();
    onSend?.();
  };

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <select aria-label="Метод" value={draft.method} onChange={(e) => setDraft({ method: e.target.value })} className={`${input} font-semibold text-nav`}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input aria-label="Адрес запроса" value={draft.url} onChange={(e) => setDraft({ url: e.target.value })} spellCheck={false} className={`${input} min-w-0 flex-1`} />
        <Button type="submit" variant="run" icon={<PlayIcon />} disabled={sending}>
          Отправить
        </Button>
      </form>
      {baseUrl && <p className="px-3 pt-1.5 font-mono text-[11px] text-faint">Адрес без сервера уходит на учебный {baseUrl}</p>}
      <div className="flex h-9 shrink-0 items-stretch border-b border-line px-3">
        <Tabs label="Части запроса" items={TABS} value={tab} onChange={setTab} idPrefix="composer" />
      </div>
      <div id="composer-panel" role="tabpanel" aria-labelledby={`composer-tab-${tab}`} className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'params' && (
          <PairsEditor
            label="Параметры запроса"
            namePlaceholder="параметр"
            pairs={query}
            onChange={(pairs) => setDraft({ url: withQuery(draft.url, pairs.map((p) => [p.name, p.value])) })}
          />
        )}
        {tab === 'headers' && <PairsEditor label="Заголовки" namePlaceholder="Content-Type" pairs={draft.headers} onChange={(headers) => setDraft({ headers })} />}
        {tab === 'body' && (
          <textarea
            aria-label="Тело запроса"
            value={draft.body}
            onChange={(e) => setDraft({ body: e.target.value })}
            spellCheck={false}
            placeholder={'{\n  "поле": "значение"\n}'}
            className={`${input} h-full min-h-[120px] w-full resize-none leading-relaxed`}
          />
        )}
        {tab === 'text' && (
          <div className="flex h-full flex-col gap-1">
            <textarea
              aria-label="Запрос текстом"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTextError(setDraftText(e.target.value));
              }}
              spellCheck={false}
              className={`${input} min-h-[120px] w-full flex-1 resize-none leading-relaxed`}
            />
            <p className={`text-[12px] ${textError ? 'text-err' : 'text-faint'}`}>
              {textError ?? 'Первая строка — метод и адрес, дальше заголовки «Имя: значение», после пустой строки — тело.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
