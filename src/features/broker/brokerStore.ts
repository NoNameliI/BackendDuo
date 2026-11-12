import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AnySandbox, KafkaSandbox, RabbitSandbox } from '@/checker/broker';
import type { ConsoleLine } from '@/engine/sim/console';
import { createPlayer, type Player, type Speed } from '@/engine/sim/player';
import type { KafkaSnapshot } from '@/engine/sim/kafka';
import type { RabbitSnapshot } from '@/engine/sim/rabbit';
import { applyProperties, type Scenario } from '@/engine/sim/scenario';
import type { Flavor, JournalEntry, Series } from '@/engine/sim/types';
import type { LiveConsumer } from './rabbitLayout';

/** The simulators and the console live in the lazy checker chunk; the store itself stays light. */
type Lib = typeof import('@/checker/broker');
let libPromise: Promise<Lib> | null = null;
export const loadBrokerLib = (): Promise<Lib> => (libPromise ??= import('@/checker/broker'));

/** Timeline length of a lab without a scenario (the console moves the clock with `sim run`). */
export const FREE_TIMELINE_MS = 60_000;
/** Messages that moved this recently (virtual ms) are drawn as dots on the edges. */
export const DOT_WINDOW_MS = 400;

/** What a lab shows: the broker built by `setup`, optionally a scenario with actors, the starting properties. */
export interface LabSpec {
  sim: Flavor;
  /** Console script that builds the starting broker (task `brokerSetup`). */
  setup: string;
  /** Scenario with the task's patch applied, before the learner's properties. */
  scenario: Scenario | null;
  /** Initial text of the properties editor. */
  props: string;
  /** Learner's starting commands (task `brokerStarter`), offered in the console. */
  starter: string;
}

export interface ConsoleEntry {
  id: number;
  command: string;
  lines: ConsoleLine[];
  exit: number;
}

export type LabTab = 'schema' | 'console' | 'journal' | 'metrics' | 'props';
export type LabStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Everything the views draw, derived once per change. */
interface LabViewBase {
  now: number;
  /** Rabbit: the node is running; Kafka: at least one broker is up. */
  up: boolean;
  scenario: Scenario | null;
  journal: readonly JournalEntry[];
  /** Per actor: messages published and processed so far. */
  counts: ReadonlyMap<string, { published: number; processed: number }>;
  /** Journal entries of the last `DOT_WINDOW_MS`. */
  recent: JournalEntry[];
}
export interface RabbitView extends LabViewBase {
  flavor: 'rabbit';
  snapshot: RabbitSnapshot;
  consumers: LiveConsumer[];
}
export interface KafkaView extends LabViewBase {
  flavor: 'kafka';
  snapshot: KafkaSnapshot;
}
export type LabView = RabbitView | KafkaView;

interface BrokerState {
  spec: LabSpec | null;
  status: LabStatus;
  error: string | null;
  props: string;
  propErrors: string[];
  entries: ConsoleEntry[];
  history: string[];
  /** Text of the console input; the solution block of the task panel writes here. */
  draft: string;
  tab: LabTab;
  selectedMsg: string | null;
  now: number;
  playing: boolean;
  speed: number;
  durationMs: number;
  /** Bumped by every change of the simulation: views depend on it. */
  version: number;

  reset: (spec: LabSpec) => Promise<void>;
  /** Runs console input (one or several lines) at the current virtual time. */
  run: (text: string) => void;
  setDraft: (text: string) => void;
  setProps: (text: string) => void;
  setTab: (tab: LabTab) => void;
  selectMsg: (msg: string | null) => void;
  clearConsole: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  step: () => void;
  setSpeed: (x: Speed) => void;
  seek: (t: number) => void;
  restart: () => void;
  /** Ctrl+Enter: play the scenario (from the start when it is over); without a scenario nothing runs on its own. */
  runScenario: () => void;
  /** What a check receives: the typed commands that are still part of the timeline, and the properties text. */
  input: () => { commands: string[]; props: string };
  view: () => LabView;
  series: () => Series[];
}

export type BrokerStore = UseBoundStore<StoreApi<BrokerState>>;

/** Calls `cb(dtMs)` on every frame until cancelled; a test passes its own. */
export type Ticker = (cb: (dtMs: number) => void) => () => void;

const frameTicker: Ticker = (cb) => {
  let id = 0;
  let last = performance.now();
  const loop = (t: number) => {
    cb(Math.min(100, Math.max(0, t - last)));
    last = t;
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(id);
};

/** Built-in console words that never change the broker: they are not replayed and not checked. */
const NO_EFFECT = new Set(['clear', 'help', 'history']);
const HISTORY_LIMIT = 200;
const ENTRY_LIMIT = 300;
let nextEntryId = 1;

interface Timed {
  at: number;
  text: string;
}

interface Built {
  box: AnySandbox;
  scenario: Scenario | null;
  propErrors: string[];
  failure: string | null;
}

export function createBrokerStore(tick: Ticker = frameTicker): BrokerStore {
  return create<BrokerState>((set, get) => {
    // Bumped by reset: a library that arrives after the task changed belongs to the old task and is dropped.
    let generation = 0;
    let lib: Lib | null = null;
    let box: AnySandbox | null = null;
    let player: Player<RabbitSnapshot | KafkaSnapshot> | null = null;
    let unsubscribe: (() => void) | null = null;
    /** Commands as typed with the virtual time they ran at; going back in time replays those up to the target. */
    let timeline: Timed[] = [];
    let replayLimit = 0;
    let failure: string | null = null;
    let cache: { version: number; view: LabView } | null = null;
    let seriesCache: { version: number; series: Series[] } | null = null;
    let counted = 0;
    const counts = new Map<string, { published: number; processed: number }>();

    /** A fresh broker: scenario with the properties applied, the setup scripts, then the typed commands up to `limit`. */
    function build(libs: Lib, spec: LabSpec, props: string, limit: number): Built {
      let scenario = spec.scenario;
      let propErrors: string[] = [];
      if (scenario) {
        const applied = applyProperties(scenario, props.split(/\r?\n/));
        scenario = applied.scenario;
        propErrors = applied.errors;
      }
      const made = libs.createSandbox(spec.sim, scenario ?? undefined);
      let broken: string | null = null;
      const strict = (script: string, what: string) => {
        const bad = made.run(script).find((r) => r.exit !== 0);
        if (bad && !broken) broken = `Ошибка в самом задании: ${what} упал(а) на «${bad.line}»: ${bad.output}`;
      };
      if (scenario) strict(scenario.setup, 'setup сценария');
      strict(spec.setup, 'настройка задания');
      for (const t of timeline) {
        if (t.at > limit) break;
        made.sim.runUntil(t.at);
        made.console.exec(t.text);
        made.sim.runUntil(made.sim.now);
      }
      return { box: made, scenario, propErrors, failure: broken };
    }

    let scenarioNow: Scenario | null = null;

    function sync(): void {
      const p = player;
      if (!p) return;
      const s = p.state();
      if (s.playing && s.now >= get().durationMs) {
        p.pause();
        return;
      }
      set({ now: s.now, playing: s.playing, speed: s.speed, version: get().version + 1 });
    }

    function startPlayer(libs: Lib, spec: LabSpec): void {
      player?.pause();
      unsubscribe?.();
      counted = 0;
      counts.clear();
      cache = null;
      seriesCache = null;
      player = createPlayer<RabbitSnapshot | KafkaSnapshot>(() => {
        const built = build(libs, spec, get().props, replayLimit);
        box = built.box;
        scenarioNow = built.scenario;
        failure = built.failure;
        counted = 0;
        counts.clear();
        cache = null;
        seriesCache = null;
        set({ propErrors: built.propErrors, error: built.failure });
        return built.box.sim;
      }, tick);
      unsubscribe = player.subscribe(sync);
      sync();
    }

    const record = (command: string, lines: ConsoleLine[], exit: number, cleared: boolean) =>
      set((s) => ({
        entries: [...(cleared ? [] : s.entries), { id: nextEntryId++, command, lines, exit }].slice(-ENTRY_LIMIT),
        history: command ? [...s.history, command].slice(-HISTORY_LIMIT) : s.history,
      }));

    const ready = () => get().status === 'ready' && box !== null && player !== null;

    return {
      spec: null,
      status: 'idle',
      error: null,
      props: '',
      propErrors: [],
      entries: [],
      history: [],
      draft: '',
      tab: 'schema',
      selectedMsg: null,
      now: 0,
      playing: false,
      speed: 1,
      durationMs: FREE_TIMELINE_MS,
      version: 0,

      reset: async (spec) => {
        const mine = ++generation;
        player?.pause();
        unsubscribe?.();
        player = null;
        box = null;
        timeline = [];
        replayLimit = 0;
        set({
          spec,
          status: 'loading',
          error: null,
          props: spec.props,
          propErrors: [],
          entries: [],
          draft: '',
          selectedMsg: null,
          now: 0,
          playing: false,
          speed: 1,
          durationMs: spec.scenario?.durationMs ?? FREE_TIMELINE_MS,
          tab: spec.scenario ? 'schema' : 'console',
          version: get().version + 1,
        });
        let libs: Lib;
        try {
          libs = lib ??= await loadBrokerLib();
        } catch (e) {
          if (mine === generation) set({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
          return;
        }
        if (mine !== generation) return;
        startPlayer(libs, spec);
        set({ status: failure ? 'failed' : 'ready' });
      },

      run: (text) => {
        if (!ready() || !text.trim()) return;
        const b = box!;
        const word = text.trim().split(/\s+/)[0];
        const at = b.sim.now;
        const r = b.console.exec(text);
        b.sim.runUntil(b.sim.now);
        if (!NO_EFFECT.has(word)) timeline.push({ at, text });
        record(text.trim(), r.lines, r.exit, r.clear === true);
        sync();
      },
      setDraft: (draft) => set({ draft }),
      setProps: (props) => {
        const { spec } = get();
        if (!spec || !lib) return;
        set({ props });
        timeline = timeline.filter((t) => t.at <= 0);
        replayLimit = 0;
        startPlayer(lib, spec);
        set({ now: 0 });
      },
      setTab: (tab) => set({ tab }),
      selectMsg: (selectedMsg) => set({ selectedMsg }),
      clearConsole: () => set({ entries: [] }),

      play: () => {
        if (!ready()) return;
        if (get().now >= get().durationMs) get().restart();
        player!.play();
      },
      pause: () => player?.pause(),
      toggle: () => (get().playing ? get().pause() : get().play()),
      step: () => {
        if (ready() && !get().playing) player!.stepEvent();
      },
      setSpeed: (x) => player?.setSpeed(x),
      seek: (t) => {
        if (!ready()) return;
        const target = Math.max(0, Math.min(t, get().durationMs));
        if (target < get().now) {
          const dropped = timeline.filter((x) => x.at > target).length;
          timeline = timeline.filter((x) => x.at <= target);
          replayLimit = target;
          if (dropped > 0) {
            record('', [{ text: `— время перемотано назад: команд после этого момента отменено: ${dropped} —`, tone: 'dim' }], 0, false);
          }
        }
        player!.seek(target);
      },
      restart: () => {
        if (!ready()) return;
        get().seek(0);
      },
      runScenario: () => {
        const { spec } = get();
        if (!spec?.scenario) return;
        get().play();
      },

      input: () => ({ commands: timeline.map((t) => t.text), props: get().props }),

      view: () => {
        const version = get().version;
        if (cache?.version === version) return cache.view;
        const b = box!;
        const journal = b.sim.journal.entries();
        for (; counted < journal.length; counted++) {
          const e = journal[counted];
          if (e.kind !== 'publish' && e.kind !== 'process') continue;
          const c = counts.get(e.actor) ?? { published: 0, processed: 0 };
          if (e.kind === 'publish') c.published++;
          else c.processed++;
          counts.set(e.actor, c);
        }
        const recent: JournalEntry[] = [];
        for (let i = journal.length - 1; i >= 0 && journal[i].at >= b.sim.now - DOT_WINDOW_MS; i--) recent.push(journal[i]);
        recent.reverse();
        const base = { now: b.sim.now, scenario: scenarioNow, journal, counts, recent };
        let view: LabView;
        if (b.model.flavor === 'kafka') {
          const snapshot = (b as KafkaSandbox).model.snapshot();
          view = { ...base, flavor: 'kafka', up: snapshot.brokers.some((x) => x.up), snapshot };
        } else {
          const rb = b as RabbitSandbox;
          const snapshot = rb.model.snapshot();
          const owner = new Map(snapshot.channels.map((c) => [c.id, c.actor]));
          const consumers: LiveConsumer[] = [];
          for (const v of snapshot.vhosts) {
            const listed = rb.model.listConsumers(v.name);
            if (!listed.ok) continue;
            for (const c of listed.value) {
              const channel = Number(/(\d+)>?$/.exec(c.channel)?.[1] ?? NaN);
              consumers.push({ vhost: v.name, queue: c.queue, tag: c.tag, prefetch: c.prefetch, actor: owner.get(channel) ?? null });
            }
          }
          view = { ...base, flavor: 'rabbit', up: snapshot.up, snapshot, consumers };
        }
        cache = { version, view };
        return view;
      },
      series: () => {
        const version = get().version;
        if (seriesCache?.version === version) return seriesCache.series;
        const series = box ? box.sim.metrics.series() : [];
        seriesCache = { version, series };
        return series;
      },
    };
  });
}

export const BrokerContext = createContext<BrokerStore | null>(null);

export function useBroker(): BrokerStore {
  const store = useContext(BrokerContext);
  if (!store) throw new Error('BrokerContext is missing');
  return store;
}
