import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ProtoSummary } from '@/engine/api/protoRun';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';

const CodeEditor = lazy(() => import('./CodeEditor'));

type Side = 'structure' | 'encode' | 'call';
const SIDE = [
  { id: 'structure', title: 'Структура' },
  { id: 'encode', title: 'Байты' },
  { id: 'call', title: 'Вызов gRPC' },
] as const;

const input = 'w-full rounded border border-line bg-well px-2 py-1 font-mono text-[12.5px] text-fg outline-none focus:border-nav';
const caption = 'font-mono text-[11px] uppercase tracking-[0.14em] text-faint';

function Structure({ summary }: { summary: ProtoSummary }) {
  if (!summary.messages.length && !summary.services.length) return <p className="text-[13px] text-faint">Пока ни одного message и service.</p>;
  return (
    <div className="space-y-3">
      {summary.package && <p className="font-mono text-[12.5px] text-dim">package {summary.package}</p>}
      {summary.messages.map((m) => (
        <table key={m.name} className="w-full font-mono text-[12.5px]">
          <caption className={`${caption} pb-1 text-left`}>message {m.name}</caption>
          <thead className="sr-only">
            <tr>
              <th>Номер</th>
              <th>Поле</th>
              <th>Тип</th>
            </tr>
          </thead>
          <tbody>
            {m.fields.map((f) => (
              <tr key={f.name} className="border-t border-line">
                <td className="w-10 py-1 pr-2 text-nav">{f.number}</td>
                <td className="py-1 pr-2 text-fg">{f.name}</td>
                <td className="py-1 text-dim">
                  {f.repeated ? 'repeated ' : f.optional ? 'optional ' : ''}
                  {f.type}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {summary.enums.map((e) => (
        <p key={e.name} className="font-mono text-[12.5px] text-dim">
          enum {e.name}: {Object.entries(e.values).map(([k, v]) => `${k} = ${v}`).join(', ')}
        </p>
      ))}
      {summary.services.map((s) => (
        <div key={s.name} className="font-mono text-[12.5px]">
          <p className={caption}>service {s.name}</p>
          {s.methods.map((m) => (
            <p key={m.name} className="text-fg">
              rpc {m.name}({m.clientStream ? 'stream ' : ''}
              {m.request}) → {m.serverStream ? 'stream ' : ''}
              {m.response}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function Encode({ summary }: { summary: ProtoSummary }) {
  const useStore = useApiSandbox();
  const encoded = useStore((s) => s.proto?.encoded ?? null);
  const encodeProto = useStore((s) => s.encodeProto);
  const [type, setType] = useState(summary.messages[0]?.name ?? '');
  const [json, setJson] = useState('{}');
  const name = summary.messages.some((m) => m.name === type) ? type : (summary.messages[0]?.name ?? '');
  const qualified = summary.package ? `${summary.package}.${name}` : name;
  if (!name) return <p className="text-[13px] text-faint">Опишите хотя бы одно сообщение message.</p>;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void encodeProto(qualified, json);
      }}
    >
      <label className="block text-[12.5px] text-dim">
        Сообщение
        <select className={`${input} mt-1`} value={name} onChange={(e) => setType(e.target.value)}>
          {summary.messages.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </label>
      <label className="block text-[12.5px] text-dim">
        Значение в JSON
        <textarea className={`${input} mt-1 h-20 resize-y`} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
      </label>
      <Button type="submit" variant="run" icon={<PlayIcon />}>
        Закодировать
      </Button>
      {encoded &&
        ('error' in encoded ? (
          <p role="alert" className="text-[12.5px] text-err">
            {encoded.error}
          </p>
        ) : (
          <div role="status" className="space-y-1 text-[12.5px]">
            <p className="text-fg">
              protobuf — <b>{encoded.bytes} Б</b>, тот же объект в JSON — {encoded.jsonBytes} Б
            </p>
            <p className="break-all font-mono text-nav" aria-label="Байты сообщения в шестнадцатеричном виде">
              {encoded.hex || '(пусто: все поля по умолчанию не передаются)'}
            </p>
            <p className="text-faint">В байтах нет имён полей — только их номера и значения. Поэтому номера нельзя менять после выпуска API.</p>
          </div>
        ))}
    </form>
  );
}

function Call({ summary }: { summary: ProtoSummary }) {
  const useStore = useApiSandbox();
  const callRpc = useStore((s) => s.callRpc);
  const methods = summary.services.flatMap((s) => s.methods.map((m) => ({ service: s.name, ...m })));
  const [choice, setChoice] = useState(0);
  const [json, setJson] = useState('{}');
  if (!methods.length) return <p className="text-[13px] text-faint">Опишите service с методами rpc, чтобы их вызвать.</p>;
  const m = methods[Math.min(choice, methods.length - 1)];
  const service = summary.package ? `${summary.package}.${m.service}` : m.service;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void callRpc(service, m.name, json);
      }}
    >
      <label className="block text-[12.5px] text-dim">
        Метод
        <select className={`${input} mt-1`} value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
          {methods.map((x, i) => (
            <option key={`${x.service}.${x.name}`} value={i}>
              {x.service}.{x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[12.5px] text-dim">
        Запрос {m.request} в JSON
        <textarea className={`${input} mt-1 h-20 resize-y`} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
      </label>
      <Button type="submit" variant="run" icon={<PlayIcon />}>
        Вызвать
      </Button>
      <p className="text-[12px] text-faint">Учебная модель: вызов уходит как POST /{service}/{m.name}, а ответ виден в ленте запросов.</p>
    </form>
  );
}

/** Protobuf tasks: the .proto editor, what it describes, its bytes and gRPC calls. */
export function ProtoPanel() {
  const useStore = useApiSandbox();
  const proto = useStore((s) => s.proto);
  const setProtoSource = useStore((s) => s.setProtoSource);
  const [side, setSide] = useState<Side>('structure');
  const [text, setText] = useState(proto?.source ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The store's source changes on reset; typing here is debounced into it.
  useEffect(() => setText(proto?.source ?? ''), [proto?.source]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!proto) return null;
  const onChange = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void setProtoSource(value), 250);
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[3fr_2fr] @3xl:grid-cols-[1fr_1fr] @3xl:grid-rows-1">
      <section aria-label="Файл .proto" className="min-h-0 border-b border-line @3xl:border-r @3xl:border-b-0">
        <Suspense fallback={null}>
          <CodeEditor language="protobuf" ariaLabel="Редактор файла .proto" value={text} onChange={onChange} />
        </Suspense>
      </section>
      <section aria-label="Что описывает файл" className="flex min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-stretch border-b border-line px-3">
          <Tabs label="Справа от файла" items={SIDE} value={side} onChange={setSide} idPrefix="proto-side" />
        </div>
        <div id="proto-side-panel" role="tabpanel" aria-labelledby={`proto-side-tab-${side}`} className="min-h-0 flex-1 overflow-auto p-3">
          {proto.error ? (
            <p role="status" className="text-[13px] text-err">
              {proto.error}
            </p>
          ) : !proto.summary ? (
            <p className="text-[13px] text-faint">Разбираю файл…</p>
          ) : side === 'structure' ? (
            <Structure summary={proto.summary} />
          ) : side === 'encode' ? (
            <Encode summary={proto.summary} />
          ) : (
            <Call summary={proto.summary} />
          )}
        </div>
      </section>
    </div>
  );
}
