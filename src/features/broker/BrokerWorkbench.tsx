import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { kafkaRules } from '@/engine/sim/kafka/rules';
import { rabbitRules } from '@/engine/sim/rabbit/rules';
import { Panel } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';
import { BrokerConsole } from './BrokerConsole';
import { ClientPanel } from './ClientPanel';
import { hasPropsTab, useBroker, type LabTab } from './brokerStore';
import { ExplainPanel } from './ExplainPanel';
import { JournalView } from './JournalView';
import { KafkaSchema } from './KafkaLogs';
import { MetricChart, type ChartSeries } from './MetricChart';
import { nextSpeed, PlayerControls, type PlayerSpeed } from './PlayerControls';
import { RabbitTopology, useElementWidth } from './RabbitTopology';

const DIFFERENCES_RABBIT = [
  'Один узел RabbitMQ без кластера; задержки сети и диска — постоянные числа.',
  'Время виртуальное: шкала и скорость относятся к модели, а не к часам компьютера.',
  'Flow control и alarm заменены переключателем «издатели заблокированы».',
  'Не моделируются: streams, транзакции, global QoS, single active consumer, приоритеты потребителей, consumer timeout.',
  'Вывод rabbitmqctl без баннера; команды sim — учебные, у настоящих инструментов их нет.',
];
const DIFFERENCES_KAFKA = [
  'Кластер из трёх брокеров в одном процессе, без сети: задержки и диск — постоянные числа; KRaft-кворум не моделируется.',
  'Время виртуальное: шкала и скорость относятся к модели, а не к часам компьютера.',
  'Размещение реплик и выбор лидера упрощены: лидер — первая живая реплика из ISR; наименьший размер сегмента снижен для учебных опытов.',
  'Не моделируются: транзакции и read_committed, сжатие сообщений, новый протокол групп (KIP-848), static membership, Connect, Streams, Schema Registry.',
  'Вывод утилит kafka-*.sh повторяет документацию, но без JVM-предупреждений; команды sim — учебные, у настоящих инструментов их нет.',
];

/** Legend names: long queue names differ at the end, so the end is kept. */
const tail = (name: string): string => (name.length > 12 ? `…${name.slice(-11)}` : name);

const ruleTitle = (kafka: boolean) => (id: string): string | undefined => ((kafka ? kafkaRules : rabbitRules) as Record<string, { ru: string }>)[id]?.ru;

const BASE_TABS: { id: LabTab; title: string }[] = [
  { id: 'schema', title: 'Схема' },
  { id: 'console', title: 'Консоль' },
  { id: 'journal', title: 'Журнал' },
  { id: 'metrics', title: 'Метрики' },
];
const tabsFor = (hasProps: boolean, hasClient: boolean): { id: LabTab; title: string }[] => [...(hasClient ? [{ id: 'client' as const, title: 'Код Python' }] : []), ...BASE_TABS, ...(hasProps ? [{ id: 'props' as const, title: 'Свойства' }] : [])];

function Metrics() {
  const lab = useBroker();
  lab((s) => s.version);
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder, 560);
  const series = lab.getState().series();
  const now = lab.getState().now;
  const end = lab.getState().durationMs;
  const view = lab.getState().view();
  const groupIds = view.flavor === 'kafka' ? view.snapshot.groups.map((g) => g.id) : [];
  const groups = useMemo(() => {
    if (view.flavor === 'kafka') {
      const rate = (id: string, label: string): ChartSeries[] => {
        const found = series.find((x) => x.id === id);
        return found ? [{ id, label, points: found.points }] : [];
      };
      const moving = (x: ChartSeries) => x.points.some((p) => p[1] > 0);
      const lag = groupIds.flatMap((g) => rate(`lag.${g}`, tail(g))).filter(moving);
      // Only partitions whose ISR changed are interesting: a flat line at full size says nothing.
      const isr = series
        .filter((x) => x.id.startsWith('isr.') && x.points.some((p) => p[1] !== x.points[0][1]))
        .map((x) => ({ id: x.id, label: tail(x.id.slice(4)), points: x.points }))
        .slice(0, 6);
      return {
        ready: lag,
        unacked: isr,
        rates: [...rate('rate.produce', 'запись'), ...rate('rate.consume', 'чтение')].filter(moving),
        latency: rate('latency.p95', 'p95').filter(moving),
      };
    }
    const pick = (suffix: string, label: (q: string) => string): ChartSeries[] =>
      series
        .filter((s) => s.id.startsWith('q.') && s.id.endsWith(suffix))
        .map((s) => ({ id: s.id, label: tail(label(s.id.slice(2, -suffix.length))), points: s.points }))
        .sort((a, b) => Math.max(0, ...b.points.map((p) => p[1])) - Math.max(0, ...a.points.map((p) => p[1])))
        .slice(0, 6);
    const rate = (id: string, label: string): ChartSeries[] => {
      const s = series.find((x) => x.id === id);
      return s ? [{ id, label, points: s.points }] : [];
    };
    return {
      ready: pick('.ready', (q) => q).filter((s) => s.points.some((p) => p[1] > 0)),
      unacked: pick('.unacked', (q) => q).filter((s) => s.points.some((p) => p[1] > 0)),
      rates: [...rate('rate.publish', 'публикации'), ...rate('rate.deliver', 'доставки'), ...rate('rate.ack', 'подтверждения')].filter((s) => s.points.some((p) => p[1] > 0)),
      latency: rate('latency.p95', 'p95').filter((s) => s.points.some((p) => p[1] > 0)),
    };
  }, [series, view.flavor, groupIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const kafka = view.flavor === 'kafka';
  const w = Math.max(320, width - 16);
  return (
    <div ref={holder} role="region" aria-label="Графики метрик" tabIndex={0} className="h-full space-y-3 overflow-y-auto p-2">
      {groups.ready.length > 0 && <MetricChart title={kafka ? 'Отставание групп потребителей' : 'Готовые сообщения в очередях'} unit="сообщ." series={groups.ready} now={now} endMs={end} width={w} />}
      {groups.unacked.length > 0 && <MetricChart title={kafka ? 'Размер ISR по разделам (изменившиеся)' : 'Выданные, но не подтверждённые'} unit={kafka ? 'реплик' : 'сообщ.'} series={groups.unacked} now={now} endMs={end} width={w} />}
      {groups.rates.length > 0 && <MetricChart title="Скорость, сообщений в секунду" unit="/с" series={groups.rates} now={now} endMs={end} width={w} />}
      {groups.latency.length > 0 && <MetricChart title="Задержка от публикации до обработки (p95)" unit="мс" series={groups.latency} now={now} endMs={end} width={w} />}
      {Object.values(groups).every((g) => g.length === 0) && (
        <p className="text-[13px] text-dim">{series.length === 0 ? 'Метрик пока нет: запустите симуляцию.' : 'Пока всё по нулям: нет сообщений в движении. Графики появятся, когда что-то произойдёт.'}</p>
      )}
    </div>
  );
}

function Props() {
  const lab = useBroker();
  const props = lab((s) => s.props);
  const errors = lab((s) => s.propErrors);
  const view = lab((s) => (s.status === 'ready' ? s.view() : null));
  lab((s) => s.version);
  const actors = view?.scenario?.actors ?? [];
  return (
    <div role="region" aria-label="Свойства сценария" tabIndex={0} className="h-full space-y-2 overflow-y-auto p-3 text-[13px]">
      <label className="block">
        <span className="mb-1 block text-dim">Свойства участников: строки вида «участник.параметр=значение», «#» — комментарий. Изменение запускает сценарий заново.</span>
        <textarea
          value={props}
          onChange={(e) => lab.getState().setProps(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Свойства"
          className="w-full rounded border border-line-strong bg-well p-2 font-mono text-[12.5px] text-fg"
        />
      </label>
      {errors.length > 0 && (
        <ul role="alert" className="list-none space-y-1 p-0 text-err">
          {errors.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
      {actors.length > 0 && (
        <div>
          <h3 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Участники сценария и их параметры</h3>
          <ul className="list-none space-y-0.5 p-0 font-mono text-[12px]">
            {actors.map((a) => (
              <li key={a.id} className="break-words">
                <span className="text-fg">{a.id}</span> <span className="text-dim">({a.kind})</span>{' '}
                <span className="text-dim">{Object.entries(a.config).map(([k, v]) => `${k}=${String(v)}`).join(' · ') || 'без параметров'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface BrokerWorkbenchProps {
  /** Buttons of the panel header (reset, check). */
  actions?: ReactNode;
  prefix: string;
  /** Path lines of the last failed check. */
  trace?: readonly string[];
  /** Hides the panel chrome (onboarding). */
  bare?: boolean;
  /** Python client tasks: runs the program (Ctrl+Enter, the Run button). */
  onRun?: () => void;
}

/** The lab: scheme, console, journal, metrics (and properties) over one simulated broker, with the player and the explanations. */
export function BrokerWorkbench({ actions, prefix, trace, onRun }: BrokerWorkbenchProps) {
  const lab = useBroker();
  const status = lab((s) => s.status);
  const error = lab((s) => s.error);
  const tab = lab((s) => s.tab);
  const now = lab((s) => s.now);
  const playing = lab((s) => s.playing);
  const speed = lab((s) => s.speed);
  const duration = lab((s) => s.durationMs);
  const msg = lab((s) => s.selectedMsg);
  const kafka = lab((s) => s.spec?.sim === 'kafka');
  const hasClient = lab((s) => s.client !== null);
  const hasProps = lab((s) => hasPropsTab(s.spec));
  lab((s) => s.version);
  const [showDiff, setShowDiff] = useState(false);
  const act = lab.getState();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || status !== 'ready') return;
    const el = e.target as HTMLElement;
    if (el.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (e.key === ' ') {
      if (el.closest('button,[role=button],[role=tab],a,summary')) return;
      e.preventDefault();
      act.toggle();
    } else if (e.key === '.') {
      act.step();
    } else if (e.key === '[' || e.key === ']') {
      act.setSpeed(nextSpeed(speed, e.key === ']' ? 1 : -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      act.restart();
    }
  };

  const items = tabsFor(hasProps, hasClient);
  const body =
    status === 'loading' || status === 'idle' ? (
      <p className="p-4 text-[13px] text-dim" role="status">
        Загружаю симулятор…
      </p>
    ) : status === 'failed' ? (
      <p role="alert" className="m-3 rounded border border-err/40 bg-err/10 p-3 text-[13px] text-err">
        {error ?? 'Лаборатория недоступна'}
      </p>
    ) : (
      <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2 [&_input[type=range]]:min-w-0">
          <p className="text-[12.5px] text-dim">
            <strong className="font-semibold text-amber">Учебная песочница: не настоящий брокер.</strong> {kafka ? 'Это упрощённая модель кластера Kafka внутри приложения.' : 'Это упрощённая модель RabbitMQ внутри приложения.'}{' '}
            <button type="button" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)} className="text-nav underline underline-offset-2">
              Чем отличается
            </button>
          </p>
          {showDiff && (
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-dim">
              {(kafka ? DIFFERENCES_KAFKA : DIFFERENCES_RABBIT).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <PlayerControls
            state={{ playing, now, speed }}
            durationMs={duration}
            onPlay={act.play}
            onPause={act.pause}
            onStep={act.step}
            onSpeed={act.setSpeed as (x: PlayerSpeed) => void}
            onSeek={act.seek}
            onRestart={act.restart}
          />
        </div>
        <div id={`${prefix}-panel`} role="tabpanel" aria-labelledby={`${prefix}-tab-${tab}`} className="min-h-0 flex-1">
          {tab === 'client' && <ClientPanel onRun={onRun} />}
          {tab === 'schema' && (kafka ? <KafkaSchema /> : <RabbitTopology />)}
          {tab === 'console' && <BrokerConsole />}
          {tab === 'journal' && (
            <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
              <LabJournal kafka={kafka} />
            </div>
          )}
          {tab === 'metrics' && <Metrics />}
          {tab === 'props' && <Props />}
        </div>
        <Explain msg={msg} trace={trace} kafka={kafka} />
      </div>
    );

  return (
    <Panel tabs={<Tabs label="Лаборатория" items={items} value={tab} onChange={(t: LabTab) => act.setTab(t)} idPrefix={prefix} />} actions={actions}>
      {body}
    </Panel>
  );
}

function LabJournal({ kafka }: { kafka: boolean }) {
  const lab = useBroker();
  lab((s) => s.version);
  const msg = lab((s) => s.selectedMsg);
  const view = lab.getState().view();
  return <JournalView entries={view.journal} selectedMsg={msg} onSelectMsg={lab.getState().selectMsg} ruleTitle={ruleTitle(kafka)} />;
}

function Explain({ msg, trace, kafka }: { msg: string | null; trace?: readonly string[]; kafka: boolean }) {
  const lab = useBroker();
  lab((s) => s.version);
  const path = msg ? lab.getState().view().journal.filter((e) => e.msg === msg) : [];
  return <ExplainPanel msg={msg} path={path} trace={trace} rules={kafka ? kafkaRules : rabbitRules} onClear={() => lab.getState().selectMsg(null)} />;
}

export default BrokerWorkbench;
