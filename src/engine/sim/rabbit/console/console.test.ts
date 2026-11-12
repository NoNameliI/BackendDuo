import { describe, expect, it } from 'vitest';
import { createConsole } from '../../console';
import { createRabbitCommands } from './index';
import { renderTable, renderTsv, parseDuration } from './format';
import { createTestBackend } from './testBackend';

function setup() {
  const b = createTestBackend();
  const con = createConsole(createRabbitCommands(b.api, b.session));
  const run = (s: string) => {
    const r = con.exec(s);
    return { text: r.lines.map((l) => l.text).join('\n'), exit: r.exit, tones: r.lines.map((l) => l.tone) };
  };
  return { ...b, run };
}

describe('format', () => {
  it('bordered table has box-drawing frame and header', () => {
    expect(renderTable(['name', 'n'], [['orders', '3'], ['a', '10']], 'bordered')).toEqual([
      '┌────────┬────┐',
      '│ name   │ n  │',
      '├────────┼────┤',
      '│ orders │ 3  │',
      '│ a      │ 10 │',
      '└────────┴────┘',
    ]);
  });
  it('borderless table drops frame and header, newlines become commas', () => {
    expect(renderTable(['name', 'n'], [['orders', '3'], ['a\nb', '10']], 'borderless')).toEqual(['orders  3', 'a,b     10']);
  });
  it('tsv has a header row and TAB separators', () => {
    expect(renderTsv(['name', 'messages'], [['q1', '2']])).toEqual(['name\tmessages', 'q1\t2']);
  });
  it('parses durations', () => {
    expect(parseDuration('5s')).toBe(5000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('x')).toBeNull();
  });
});

describe('rabbitmqadmin', () => {
  it('declares noun-first and verb-first, lists with a bordered table', () => {
    const t = setup();
    expect(t.run("rabbitmqadmin queues declare --name orders --type classic --durable true").exit).toBe(0);
    expect(t.run('rabbitmqadmin declare queue --name emails --durable=true').exit).toBe(0);
    expect(t.run('rabbitmqadmin --vhost / exchanges declare --name shop --type topic --durable true').text).toContain("declared exchange 'shop'");
    expect(t.run('rabbitmqadmin queues list').text.split('\n')).toEqual([
      '┌────────┬────────────┬──────────┬────────────────┬─────────────────────────┬───────────┐',
      '│ name   │ queue_type │ messages │ messages_ready │ messages_unacknowledged │ consumers │',
      '├────────┼────────────┼──────────┼────────────────┼─────────────────────────┼───────────┤',
      '│ orders │ classic    │ 0        │ 0              │ 0                       │ 0         │',
      '│ emails │ classic    │ 0        │ 0              │ 0                       │ 0         │',
      '└────────┴────────────┴──────────┴────────────────┴─────────────────────────┴───────────┘',
    ]);
    expect(t.run('rabbitmqadmin list exchanges').text).toContain('│ shop │ topic │ true    │');
  });
  it('--non-interactive gives a borderless table without header; --columns selects', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name orders --durable true');
    t.run('rabbitmqadmin queues declare --name emails --durable true');
    expect(t.run('rabbitmqadmin --non-interactive queues list --columns name,message_count').text).toBe('orders  0\nemails  0');
    expect(t.run('rabbitmqadmin queues list --columns nope').exit).toBe(2);
  });
  it('bindings declare and list, destination type validated, required flags reported', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    t.run('rabbitmqadmin exchanges declare --name x --type direct --durable true');
    expect(t.run('rabbitmqadmin bindings declare --source x --destination-type queue --destination q --routing-key k --arguments \'{"x-match":"all"}\'').exit).toBe(0);
    expect(t.run('rabbitmqadmin --non-interactive bindings list').text).toBe('x  q  queue  k');
    const miss = t.run('rabbitmqadmin bindings declare --source x');
    expect(miss.exit).toBe(2);
    expect(miss.text).toContain('--destination <DESTINATION>');
    expect(t.run('rabbitmqadmin bindings declare --source x --destination-type topic --destination q --routing-key k').exit).toBe(2);
    expect(t.run('rabbitmqadmin bindings delete --source x --destination-type queue --destination q --routing-key k').exit).toBe(0);
  });
  it('publish message: flags, default exchange, properties, not routed, stdin payload', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    expect(t.run("rabbitmqadmin publish message -e '' -k q -m hello -p '{\"delivery_mode\":2}'").text).toBe('published the message');
    expect(t.log.at(-1)).toBe('publish |q|hello|true|{"delivery_mode":2}');
    expect(t.run('rabbitmqadmin publish message -k nowhere -m x').text).toContain('not routed');
    expect(t.run('rabbitmqadmin publish message -e nope -k k').text).toBe("Error: 404 NOT_FOUND - no exchange 'nope' in vhost '/'");
    t.run('rabbitmqadmin publish message -k q -f - <<EOF\nline1\nEOF');
    expect(t.log.at(-1)).toContain('|q|line1|');
    expect(t.run('rabbitmqadmin publish message -k q -m a -f -').exit).toBe(2);
  });
  it('get messages: four ack modes', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    t.run('rabbitmqadmin publish message -k q -m one');
    t.run('rabbitmqadmin publish message -k q -m two');
    // peek: requeue keeps both, redelivered flag appears afterwards
    const peek = t.run('rabbitmqadmin --non-interactive get messages -q q -c 2 -a ack_requeue_true');
    expect(peek.text).toBe('  q  false  3  one\n  q  false  3  two');
    expect(t.queues.get('q')!.msgs.map((m) => m.body)).toEqual(['one', 'two']);
    expect(t.queues.get('q')!.msgs.every((m) => m.redelivered)).toBe(true);
    const bordered = t.run('rabbitmqadmin get messages --queue q');
    expect(bordered.text.split('\n')[1]).toBe('│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │');
    expect(bordered.text).toContain('│ q           │ true');
    expect(t.queues.get('q')!.msgs.map((m) => m.body)).toEqual(['two']);
    t.run('rabbitmqadmin get messages -q q -a reject_requeue_false');
    expect(t.queues.get('q')!.msgs).toHaveLength(0);
    expect(t.run('rabbitmqadmin get messages -q q -a bogus').exit).toBe(2);
    expect(t.run('rabbitmqadmin get messages -q missing').text).toBe("Error: 404 NOT_FOUND - no queue 'missing' in vhost '/'");
  });
  it('delete / purge, idempotently, error texts 404/406/403', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    t.run('rabbitmqadmin publish message -k q -m a');
    expect(t.run('rabbitmqadmin queues purge --name q').text).toContain('1 messages removed');
    expect(t.run('rabbitmqadmin purge queue --name nope').text).toBe("Error: 404 NOT_FOUND - no queue 'nope' in vhost '/'");
    expect(t.run('rabbitmqadmin queues delete --name nope').exit).toBe(1);
    expect(t.run('rabbitmqadmin queues delete --name nope --idempotently').exit).toBe(0);
    expect(t.run('rabbitmqadmin queues declare --name q --durable false')).toMatchObject({ exit: 1, text: expect.stringContaining('406 PRECONDITION_FAILED') });
    t.run('rabbitmqadmin exchanges declare --name e --type direct --durable true');
    expect(t.run('rabbitmqadmin exchanges declare --name e --type fanout --durable true').text).toContain('406 PRECONDITION_FAILED');
    expect(t.run('rabbitmqadmin exchanges declare --name amq.custom --type fanout').text).toContain('403 ACCESS_REFUSED');
  });
  it('acts as another user (-u and sim as) and reports 403', () => {
    const t = setup();
    expect(t.run('rabbitmqadmin -u bob -p secret queues declare --name q --durable true').text).toContain('403 ACCESS_REFUSED');
    expect(t.run('sim as bob rabbitmqadmin queues declare --name q --durable true').text).toContain("refused for user 'bob'");
    expect(t.session.user).toBe('guest');
    expect(t.run('rabbitmqadmin queues declare --name q --durable true').exit).toBe(0);
  });
  it('global -p is the password before the group and properties after publish', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    expect(t.run("rabbitmqadmin -p secret publish message -k q -p '{}'").exit).toBe(0);
  });
  it('rejects v1 syntax with a hint, unknown options and streams', () => {
    const t = setup();
    const v1 = t.run('rabbitmqadmin declare queue name=q durable=true');
    expect(v1.exit).toBe(2);
    expect(v1.text).toContain('v2');
    expect(t.run('rabbitmqadmin queues declare --name q --bogus 1').text).toBe("error: unexpected argument '--bogus' found");
    expect(t.run('rabbitmqadmin queues declare --name q --type stream').exit).toBe(1);
    expect(t.run('rabbitmqadmin queues declare --name q --durable maybe').text).toContain('was not `true` or `false`');
    expect(t.run('rabbitmqadmin queues declare --name q --arguments [1]').text).toContain('JSON object');
    expect(t.run('rabbitmqadmin nonsense thing').exit).toBe(2);
  });
  it('accepts unique long-option prefixes', () => {
    const t = setup();
    expect(t.run('rabbitmqadmin queues declare --na q2 --dur true --auto true').exit).toBe(0);
  });
});

describe('rabbitmqctl', () => {
  it('list_queues prints a header and TAB rows, items choose columns, lq is quiet alias', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name orders --durable true');
    t.run('rabbitmqadmin publish message -k orders -m a');
    expect(t.run('rabbitmqctl list_queues').text).toBe('name\tmessages\norders\t1');
    expect(t.run('rabbitmqctl list_queues -p / name messages_ready messages_unacknowledged consumers type').text).toBe(
      'name\tmessages_ready\tmessages_unacknowledged\tconsumers\ttype\norders\t1\t0\t0\tclassic',
    );
    expect(t.run('lq').text).toBe('name\tmessages\norders\t1');
    expect(t.run('rabbitmqctl list_queues memory').text).toContain('not simulated');
    expect(t.run('rabbitmqctl list_queues bogus').exit).toBe(64);
  });
  it('lists exchanges, bindings, consumers, vhosts, users', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    t.run('rabbitmqadmin exchanges declare --name x --type fanout --durable true');
    t.run('rabbitmqadmin bindings declare --source x --destination-type queue --destination q --routing-key k');
    expect(t.run('rabbitmqctl list_exchanges').text).toBe('name\ttype\nx\tfanout');
    expect(t.run('rabbitmqctl list_exchanges name durable').text).toBe('name\tdurable\nx\ttrue');
    expect(t.run('rabbitmqctl list_bindings').text).toBe('source_name\tsource_kind\tdestination_name\tdestination_kind\trouting_key\targuments\nx\texchange\tq\tqueue\tk\t{}');
    expect(t.run('rabbitmqctl list_consumers').text).toBe('queue_name\tchannel_pid\tconsumer_tag\tack_required\tprefetch_count\targuments\norders\t<rabbit@sim.1.0>\tamq.ctag-1\ttrue\t5\t{}');
    expect(t.run('rabbitmqctl list_vhosts').text).toBe('name\n/\nshop');
    expect(t.run('rabbitmqctl list_users').text).toBe('user\ttags\nguest\t[administrator]\nbob\t[]');
  });
  it('management actions', () => {
    const t = setup();
    expect(t.run('rabbitmqctl add_vhost shop').exit).toBe(0);
    expect(t.run('rabbitmqctl add_user alice s3cret').exit).toBe(0);
    expect(t.run('rabbitmqctl set_permissions -p shop alice ".*" ".*" ".*"').exit).toBe(0);
    expect(t.log).toContain('perm shop alice .* .* .*');
    expect(t.run('rabbitmqctl set_permissions alice').text).toContain('wrong number of arguments');
    expect(t.run('rabbitmqctl delete_vhost /').text).toBe('Error:\n403 ACCESS_REFUSED - cannot delete default vhost \'/\'');
    t.run('rabbitmqadmin queues declare --name q --durable true');
    t.run('rabbitmqadmin publish message -k q -m a');
    expect(t.run('rabbitmqctl delete_queue q --if-empty').text).toContain('406 PRECONDITION_FAILED');
    expect(t.run('rabbitmqctl purge_queue q').exit).toBe(0);
    expect(t.run('rabbitmqctl delete_queue q').text).toBe('Queue was successfully deleted with 0 messages');
    expect(t.run('rabbitmqctl purge_queue q').text).toBe("Error:\n404 NOT_FOUND - no queue 'q' in vhost '/'");
    expect(t.run('rabbitmqctl frobnicate').exit).toBe(64);
  });
});

describe('sim (teaching only)', () => {
  it('consume, ack and requeue through a persistent sim channel', () => {
    const t = setup();
    t.run('rabbitmqadmin queues declare --name q --durable true');
    expect(t.run('sim consume q --prefetch 2').text).toContain('нет неподтверждённых');
    expect(t.run('sim ack 99').text).toContain('406 PRECONDITION_FAILED');
    expect(t.run('sim ack 1').text).toContain('сначала sim consume');
    expect(t.run('sim consume q --prefetch 1').exit).toBe(0);
    expect(t.run('sim run 5s').text).toBe('[sim] прошло 5000 мс виртуального времени');
    expect(t.log).toContain('advance 5000');
    expect(t.run('sim restart').text).toContain('перезапущен');
    expect(t.log.slice(-2)).toEqual(['crash', 'restart']);
    expect(t.run('sim run later').exit).toBe(2);
    expect(t.run('sim').tones.every((x) => x === 'dim')).toBe(true);
  });
});
