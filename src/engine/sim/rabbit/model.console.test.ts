import { describe, expect, it } from 'vitest';
import { createConsole } from '../console';
import { createRabbitCommands, type RabbitConsoleApi } from './console';
import { make } from './harness';

function setup() {
  const t = make();
  // the model must satisfy the console's interface structurally
  const api: RabbitConsoleApi = t.model;
  const con = createConsole(createRabbitCommands(api));
  const run = (s: string) => {
    const r = con.exec(s);
    return { text: r.lines.map((l) => l.text).join('\n'), exit: r.exit };
  };
  return { ...t, run };
}

describe('console over the model', () => {
  it('declares, binds, publishes, gets and lists', () => {
    const { run, model } = setup();
    expect(run('rabbitmqadmin exchanges declare --name orders --type direct --durable true').exit).toBe(0);
    expect(run('rabbitmqadmin queues declare --name emails --type classic --durable true').exit).toBe(0);
    expect(run('rabbitmqadmin bindings declare --source orders --destination-type queue --destination emails --routing-key new').exit).toBe(0);
    expect(run('rabbitmqadmin publish message --exchange orders --routing-key new --payload hello').exit).toBe(0);
    expect(run('rabbitmqadmin publish message --exchange orders --routing-key lost --payload nowhere').text).toContain('not routed');
    const ctl = run('rabbitmqctl list_queues name messages_ready');
    expect(ctl.exit).toBe(0);
    expect(ctl.text).toContain('emails\t1');
    const got = run('rabbitmqadmin get messages --queue emails --count 1');
    expect(got.exit).toBe(0);
    expect(got.text).toContain('hello');
    expect(model.listQueues('/')).toMatchObject({ ok: true, value: [{ name: 'emails', ready: 0 }] });
    expect(run('rabbitmqadmin queues list --non-interactive').text).toContain('emails');
  });

  it('reports model errors in the console', () => {
    const { run } = setup();
    run('rabbitmqadmin queues declare --name q --type classic --durable true');
    const bad = run('rabbitmqadmin queues declare --name q --type classic --durable false');
    expect(bad.exit).not.toBe(0);
    expect(bad.text).toContain('PRECONDITION_FAILED');
    expect(run('rabbitmqadmin queues declare --name amq.x --type classic --durable true').text).toContain('ACCESS_REFUSED');
  });

  it('sim consume and ack drive the clock-backed model', () => {
    const { run, model } = setup();
    run('rabbitmqadmin queues declare --name q --type classic --durable true');
    run('rabbitmqadmin publish message --routing-key q --payload one');
    expect(run('sim consume q --prefetch 1').exit).toBe(0);
    expect(model.listConsumers('/')).toMatchObject({ ok: true, value: [{ queue: 'q', prefetch: 1 }] });
    expect(run('sim run 2s').exit).toBe(0);
  });
});
