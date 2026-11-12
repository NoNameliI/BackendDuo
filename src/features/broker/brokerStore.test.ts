import { describe, expect, it } from 'vitest';
import { SCENARIO } from '@/checker/brokerFixture';
import { parseScenario } from '@/engine/sim/scenario';
import { createBrokerStore, type LabSpec, type Ticker } from './brokerStore';

/** A ticker the test drives by hand. */
function manualTicker(): { tick: Ticker; fire: (dt: number) => void; running: () => boolean } {
  let cb: ((dt: number) => void) | null = null;
  return {
    tick: (f) => {
      cb = f;
      return () => {
        cb = null;
      };
    },
    fire: (dt) => cb?.(dt),
    running: () => cb !== null,
  };
}

const spec = (over: Partial<LabSpec> = {}): LabSpec => ({
  sim: 'rabbit',
  setup: 'rabbitmqadmin queues declare --name jobs --type classic --durable true',
  scenario: parseScenario(SCENARIO),
  props: '',
  starter: '',
  ...over,
});

async function open(over: Partial<LabSpec> = {}) {
  const ticker = manualTicker();
  const store = createBrokerStore(ticker.tick);
  await store.getState().reset(spec(over));
  return { store, ticker, get: store.getState };
}

describe('brokerStore', () => {
  it('[lab-reset] builds the broker from the setup scripts and shows the scenario timeline', async () => {
    const { get } = await open();
    expect(get().status).toBe('ready');
    expect(get().durationMs).toBe(4000);
    const names = get().view().snapshot.vhosts[0].queues.map((q) => q.name);
    expect(names).toEqual(['emails', 'jobs']);
    expect(get().tab).toBe('schema');
  });

  it('[lab-console] runs commands at the current time, keeps history and replays only effective ones', async () => {
    const { get } = await open({ scenario: null });
    expect(get().tab).toBe('console');
    get().run('rabbitmqadmin queues declare --name extra --type classic --durable true');
    get().run('help');
    get().run('nonsense');
    expect(get().entries.map((e) => e.exit)).toEqual([0, 0, 127]);
    expect(get().history).toHaveLength(3);
    expect(get().input().commands).toHaveLength(2);
    expect(get().view().snapshot.vhosts[0].queues.map((q) => q.name)).toContain('extra');
  });

  it('[lab-player] advances with the ticker, pauses at the end and starts over from the end', async () => {
    const { get, ticker } = await open();
    get().play();
    expect(get().playing).toBe(true);
    ticker.fire(1000);
    expect(get().now).toBe(1000);
    expect(get().view().journal.some((e) => e.kind === 'publish')).toBe(true);
    get().setSpeed(4);
    ticker.fire(1000);
    expect(get().now).toBe(5000);
    expect(get().playing).toBe(false);
    expect(ticker.running()).toBe(false);
    get().play();
    expect(get().now).toBe(0);
    expect(get().playing).toBe(true);
  });

  it('[lab-seek] going back replays the commands up to the target and drops later ones', async () => {
    const { get, ticker } = await open();
    get().run('rabbitmqadmin queues declare --name early --type classic --durable true');
    get().seek(1500);
    expect(get().now).toBe(1500);
    get().run('rabbitmqadmin queues declare --name late --type classic --durable true');
    expect(get().input().commands).toHaveLength(2);
    get().seek(500);
    expect(get().now).toBe(500);
    const queues = get().view().snapshot.vhosts[0].queues.map((q) => q.name);
    expect(queues).toContain('early');
    expect(queues).not.toContain('late');
    expect(get().input().commands).toHaveLength(1);
    expect(get().entries.at(-1)?.lines[0].text).toContain('отменено: 1');
    get().restart();
    expect(get().now).toBe(0);
    expect(get().view().snapshot.vhosts[0].queues.map((q) => q.name)).toContain('early');
    expect(ticker.running()).toBe(false);
  });

  it('[lab-deterministic] the same steps give the same journal and metrics', async () => {
    const run = async () => {
      const { get } = await open();
      get().seek(4000);
      return JSON.stringify([get().view().journal, get().series()]);
    };
    expect(await run()).toBe(await run());
  });

  it('[lab-props] properties rebuild the run from the start and report their mistakes', async () => {
    const { get } = await open();
    get().seek(2000);
    const before = get().view().journal.filter((e) => e.kind === 'fault').length;
    get().setProps('mailer.idempotent=true\nnobody.x=1');
    expect(get().now).toBe(0);
    expect(get().propErrors.length).toBeGreaterThan(0);
    get().seek(4000);
    const processed = get().view().journal.filter((e) => e.actor === 'mailer' && e.text.includes('пропускает дубль')).length;
    expect(processed).toBeGreaterThan(0);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(get().input().props).toContain('mailer.idempotent=true');
  });

  it('[lab-counts] counts publications and processed messages per actor', async () => {
    const { get } = await open();
    get().seek(4000);
    const counts = get().view().counts;
    expect(counts.get('api')?.published).toBe(10);
    expect(counts.get('mailer')?.processed).toBeGreaterThan(0);
  });

  it('[lab-kafka] says plainly that the Kafka simulator is not there yet', async () => {
    const { get } = await open({ sim: 'kafka', scenario: null });
    expect(get().status).toBe('failed');
    expect(get().error).toContain('Kafka');
  });

  it('[lab-bad-setup] a broken setup is reported as a content error', async () => {
    const { get } = await open({ setup: 'rabbitmqadmin queues declare --name' });
    expect(get().status).toBe('failed');
    expect(get().error).toContain('Ошибка в самом задании');
  });

  it('[lab-stale-reset] the answer of a superseded reset is dropped', async () => {
    const ticker = manualTicker();
    const store = createBrokerStore(ticker.tick);
    const first = store.getState().reset(spec({ setup: '' }));
    const second = store.getState().reset(spec());
    await Promise.all([first, second]);
    expect(store.getState().view().snapshot.vhosts[0].queues.map((q) => q.name)).toEqual(['emails', 'jobs']);
  });
});
