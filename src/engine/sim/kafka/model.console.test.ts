import { describe, expect, it } from 'vitest';
import { createConsole } from '../console';
import { createKafkaCommands } from './console';
import { make } from './harness';

const BS = '--bootstrap-server localhost:9092';

function setup(scenario?: unknown) {
  const t = make(scenario);
  const con = createConsole(createKafkaCommands(t.model));
  const run = (s: string) => {
    const r = con.exec(s);
    return { text: r.lines.map((l) => l.text).join('\n'), exit: r.exit, lines: r.lines };
  };
  return { ...t, run };
}

describe('kafka-topics', () => {
  it('creates, lists and describes with the real line format', () => {
    const { run } = setup();
    expect(run(`kafka-topics.sh ${BS} --create --topic orders --partitions 2 --replication-factor 3 --config retention.ms=60000`).text).toBe('Created topic orders.');
    run(`kafka-topics ${BS} --create --topic alpha`);
    expect(run(`kafka-topics.sh ${BS} --list`).text).toBe('alpha\norders');
    const d = run(`kafka-topics.sh ${BS} --describe --topic orders`).lines.map((l) => l.text);
    expect(d[0]).toMatch(/^Topic: orders\tTopicId: \S+\tPartitionCount: 2\tReplicationFactor: 3\tConfigs: retention\.ms=60000$/);
    expect(d[1]).toMatch(/^\tTopic: orders\tPartition: 0\tLeader: \d\tReplicas: \d(,\d)*\tIsr: \d(,\d)*\tElr: N\/A\tLastKnownElr: N\/A$/);
    expect(d).toHaveLength(3);
  });

  it('requires --bootstrap-server and one action, reports model errors', () => {
    const { run } = setup();
    const noBs = run('kafka-topics.sh --list');
    expect(noBs.exit).toBe(1);
    expect(noBs.text).toBe('Missing required argument "[bootstrap-server]"');
    expect(run(`kafka-topics.sh ${BS}`).text).toContain('exactly one action');
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 2 --replication-factor 1`);
    const dup = run(`kafka-topics.sh ${BS} --create --topic t`);
    expect(dup.exit).toBe(1);
    expect(dup.lines[0].tone).toBe('err');
    expect(dup.text).toMatch(/^Error: .*exist/);
    expect(run(`kafka-topics.sh ${BS} --create --topic t --if-not-exists`)).toMatchObject({ text: '', exit: 0 });
    expect(run(`kafka-topics.sh ${BS} --alter --topic t --partitions 1`).exit).toBe(1);
    expect(run(`kafka-topics.sh ${BS} --alter --topic t --config a=b`).text).toContain('can\'t be used with action "[alter]"');
    expect(run(`kafka-topics.sh ${BS} --alter --topic t --partitions 4`)).toMatchObject({ text: '', exit: 0 });
    expect(run(`kafka-topics.sh ${BS} --delete --topic nope`).text).toBe("Error: Topic 'nope' does not exist as expected");
    expect(run(`kafka-topics.sh ${BS} --delete --topic nope --if-exists`).exit).toBe(0);
    expect(run(`kafka-topics.sh ${BS} --delete --topic t`)).toMatchObject({ text: '', exit: 0 });
    expect(run(`kafka-topics.sh ${BS} --list`).text).toBe('');
  });

  it('filters partitions after a broker crash: partition lines only', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 3 --replication-factor 3`);
    expect(run(`kafka-topics.sh ${BS} --describe --under-replicated-partitions`).text).toBe('');
    expect(run('sim crash broker 2').text).toBe('[sim] брокер 2 остановлен');
    run('sim run 40s');
    const r = run(`kafka-topics.sh ${BS} --describe --under-replicated-partitions`);
    expect(r.text).not.toContain('PartitionCount');
    const lines = r.text.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) expect(l).toMatch(/^\tTopic: t\tPartition: \d\tLeader: (\d|none)\tReplicas: .*\tIsr: [\d,]*\tElr: N\/A\tLastKnownElr: N\/A$/);
    expect(run(`kafka-topics.sh ${BS} --describe --topics-with-overrides`).text).toBe('');
  });
});

describe('producer and consumer', () => {
  it('sends heredoc lines and reads them back with the exit line', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 1`);
    const sent = run(`kafka-console-producer.sh ${BS} --topic t <<EOF\nfirst\nsecond\nthird\nEOF`);
    expect(sent).toMatchObject({ text: '', exit: 0 });
    const got = run(`kafka-console-consumer.sh ${BS} --topic t --from-beginning --max-messages 2`);
    expect(got.lines.map((l) => [l.text, l.tone])).toEqual([
      ['first', 'out'],
      ['second', 'out'],
      ['Processed a total of 2 messages', 'err'],
    ]);
    const all = run(`kafka-console-consumer.sh ${BS} --topic t --from-beginning`);
    expect(all.text).toBe('first\nsecond\nthird\n(песочница: новых сообщений нет)\nProcessed a total of 3 messages');
  });

  it('parses keys, prints key/partition/offset/timestamp/headers, accepts <<<', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 1`);
    run(`kafka-console-producer.sh ${BS} --topic t --reader-property parse.key=true --reader-property key.separator=: <<EOF\nk1:v1\nk2:v2\nEOF`);
    const r = run(`kafka-console-consumer.sh ${BS} --topic t --from-beginning --max-messages 2 --formatter-property print.key=true --formatter-property print.partition=true --formatter-property print.offset=true --formatter-property print.headers=true`);
    expect(r.lines[0].text).toBe('Partition:0\tOffset:0\tNO_HEADERS\tk1\tv1');
    expect(r.lines[1].text).toBe('Partition:0\tOffset:1\tNO_HEADERS\tk2\tv2');
    const ts = run(`kafka-console-consumer.sh ${BS} --topic t --partition 0 --offset 1 --max-messages 1 --formatter-property print.timestamp=true`);
    expect(ts.lines[0].text).toMatch(/^CreateTime:\d{13}\tv2$/);
    run(`kafka-console-producer.sh ${BS} --topic t <<< "hello world"`);
    expect(run(`kafka-console-consumer.sh ${BS} --topic t --partition 0 --offset 2 --max-messages 1`).lines[0].text).toBe('hello world');
  });

  it('warns about deprecated --property and rejects both spellings together', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 1`);
    const p = run(`kafka-console-producer.sh ${BS} --topic t --property parse.key=true --property key.separator=, <<EOF\na,b\nEOF`);
    expect(p.lines[0]).toEqual({ text: 'Warning: --property is deprecated and will be removed in a future version. Use --reader-property instead.', tone: 'err' });
    const c = run(`kafka-console-consumer.sh ${BS} --topic t --from-beginning --max-messages 1 --property print.key=true`);
    expect(c.lines[0]).toEqual({ text: 'Option --property is deprecated and will be removed in a future version. Use --formatter-property instead.', tone: 'err' });
    expect(c.lines[1].text).toBe('a\tb');
    expect(run(`kafka-console-consumer.sh ${BS} --topic t --property a=b --formatter-property a=b`).text).toBe('Options --property and --formatter-property cannot be specified together.');
    expect(run(`kafka-console-producer.sh ${BS} --topic t --property a=b --reader-property a=b`).exit).toBe(1);
  });

  it('reports a missing key separator after sending the earlier lines; offset needs partition', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 1`);
    const r = run(`kafka-console-producer.sh ${BS} --topic t --reader-property parse.key=true <<EOF\na\tb\nplain\nEOF`);
    expect(r.exit).toBe(1);
    expect(r.text).toBe("Error: No key separator found on line number 2: 'plain'");
    expect(run(`kafka-console-consumer.sh ${BS} --topic t --offset 0`).text).toBe('The partition is required when offset is specified.');
    expect(run(`kafka-console-consumer.sh --topic t`).text).toBe('Missing required argument "[bootstrap-server]"');
  });
});

describe('kafka-consumer-groups', () => {
  function withGroup() {
    const h = setup();
    h.run(`kafka-topics.sh ${BS} --create --topic t --partitions 2 --replication-factor 1`);
    h.run(`kafka-console-producer.sh ${BS} --topic t <<EOF\na\nb\nc\nd\nEOF`);
    h.run(`kafka-console-consumer.sh ${BS} --topic t --group g --from-beginning --max-messages 4`);
    return h;
  }

  it('lists, describes a group without members as a table and warns on stderr', () => {
    const { run } = withGroup();
    expect(run(`kafka-consumer-groups.sh ${BS} --list`).text).toBe('g');
    const d = run(`kafka-consumer-groups.sh ${BS} --describe --group g`);
    expect(d.lines[0]).toEqual({ text: "Consumer group 'g' has no active members.", tone: 'err' });
    const rows = d.lines.slice(1).map((l) => l.text);
    expect(rows[0]).toBe('');
    expect(rows[1]).toBe('GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID');
    expect(rows[2]).toMatch(/^g               t               0          \d+ +\d+ +0 +- +- +-$/);
    expect(rows).toHaveLength(4);
    expect(run(`kafka-consumer-groups.sh ${BS} --describe --group g --state`).text).toMatch(/GROUP +COORDINATOR \(ID\) +ASSIGNMENT-STRATEGY +STATE +#MEMBERS\ng +broker-\d:9092 \(\d\) +- +Empty +0/);
    expect(run(`kafka-consumer-groups.sh ${BS} --describe --group nope`).text).toMatch(/^Error: .*nope/);
    expect(run(`kafka-consumer-groups.sh ${BS} --describe`).exit).toBe(1);
  });

  it('reset-offsets is a dry run until --execute; partition filter touches only that partition', () => {
    const { run } = withGroup();
    const dry = run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --topic t --to-earliest`);
    expect(dry.lines.map((l) => l.text)).toEqual(['', 'GROUP           TOPIC           PARTITION  NEW-OFFSET', 'g               t               0          0', 'g               t               1          0']);
    const before = run(`kafka-consumer-groups.sh ${BS} --describe --group g`).text;
    const ex = run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --topic t:1 --to-earliest --execute`);
    expect(ex.text).toContain('g               t               1          0');
    expect(ex.text).not.toContain('t               0          0');
    const after = run(`kafka-consumer-groups.sh ${BS} --describe --group g`).text;
    expect(after).not.toBe(before);
    expect(run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --topic t --to-offset 1 --export`).text).toBe('t,0,0\nt,1,1');
    expect(run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --topic t`).text).toContain('exactly one of these options');
    expect(run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --all-topics --to-datetime 2026-01-01T00:00:00.000`).exit).toBe(0);
    expect(run(`kafka-consumer-groups.sh ${BS} --reset-offsets --group g --all-topics --to-datetime nonsense`).exit).toBe(1);
  });

  it('deletes groups', () => {
    const { run } = withGroup();
    expect(run(`kafka-consumer-groups.sh ${BS} --delete --group g`).text).toBe("Deletion of requested consumer groups ('g') was successful.");
    expect(run(`kafka-consumer-groups.sh ${BS} --list`).text).toBe('');
    const again = run(`kafka-consumer-groups.sh ${BS} --delete --group g`);
    expect(again.exit).toBe(1);
    expect(again.text).toContain("* Group 'g' could not be deleted due to:");
  });
});

describe('kafka-configs and sim', () => {
  it('alters and describes topic and broker configs', () => {
    const { run } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 1`);
    expect(run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --alter --add-config retention.ms=1000,min.insync.replicas=1`).text).toBe('Completed updating config for topic t.');
    expect(run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --describe`).text).toBe(
      'Dynamic configs for topic t are:\n  retention.ms=1000 sensitive=false synonyms={DYNAMIC_TOPIC_CONFIG:retention.ms=1000}\n  min.insync.replicas=1 sensitive=false synonyms={DYNAMIC_TOPIC_CONFIG:min.insync.replicas=1}',
    );
    expect(run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --alter --delete-config retention.ms`).exit).toBe(0);
    const all = run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --describe --all`);
    expect(all.text.startsWith('All configs for topic t are:')).toBe(true);
    expect(all.text).toContain('cleanup.policy=');
    expect(run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --alter --add-config nope=1`).exit).toBe(1);
    expect(run(`kafka-configs.sh ${BS} --entity-type topics --entity-name t --alter`).text).toContain('At least one of');
    expect(run(`kafka-configs.sh ${BS} --entity-type users --entity-name u --describe`).exit).toBe(1);
    expect(run(`kafka-configs.sh ${BS} --entity-type brokers --entity-default --alter --add-config min.insync.replicas=2`).text).toBe('Completed updating default config for brokers in the cluster.');
    expect(run(`kafka-configs.sh ${BS} --entity-type brokers --entity-default --describe`).text).toContain('min.insync.replicas=2');
  });

  it('sim commands print [sim] lines and drive the model', () => {
    const { run, model } = setup();
    expect(run('sim run 10s').text).toBe('[sim] прошло 10000 мс виртуального времени');
    expect(model.now).toBe(10000);
    expect(run('sim stall broker 2 40s').text).toContain('[sim] брокер 2');
    expect(run('sim crash broker 3').lines[0].tone).toBe('dim');
    expect(run('sim restart broker 3').text).toContain('[sim] брокер 3 запущен');
    expect(run('sim crash broker 9').exit).toBe(1);
    expect(run('sim run').exit).toBe(2);
    expect(run('sim').text).toContain('[sim] run 10s');
  });
});

describe('error codes', () => {
  it('broker errors carry the Kafka error code, usage errors none', () => {
    const { run, model } = setup();
    run(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 3`);
    const code = (cmd: string) => {
      const con = createConsole(createKafkaCommands(model));
      return con.exec(cmd).code;
    };
    expect(code(`kafka-topics.sh ${BS} --create --topic t --partitions 1 --replication-factor 3`)).toBe('36');
    expect(code(`kafka-topics.sh ${BS} --create --topic u --partitions 0 --replication-factor 3`)).toBe('37');
    expect(code(`kafka-topics.sh ${BS} --describe --topic nope`)).toBe('3');
    expect(code(`kafka-topics.sh ${BS}`)).toBeUndefined();
    expect(code(`kafka-topics.sh ${BS} --list`)).toBeUndefined();
  });
});
