import { createConsole, type Console, type ConsoleCommand } from './console';
import { Sim } from './kernel';
import { KafkaModel, type KafkaSnapshot } from './kafka';
import { createKafkaCommands } from './kafka/console';
import { RabbitModel, type RabbitSnapshot } from './rabbit';
import { createRabbitCommands } from './rabbit/console';
import type { Scenario } from './scenario';
import type { Flavor, Model } from './types';

/** A command that ran and how it ended. */
export interface CommandRecord {
  line: string;
  exit: number;
  output: string;
}

/** A fresh simulator with its console; the same wiring the lab, the checks and the Python clients use. */
export interface Sandbox<M, S> {
  model: M;
  sim: Sim<S>;
  console: Console;
  /** Runs a script command by command and records every one. */
  run(script: string): CommandRecord[];
}
export type RabbitSandbox = Sandbox<RabbitModel, RabbitSnapshot>;
export type KafkaSandbox = Sandbox<KafkaModel, KafkaSnapshot>;
export type AnySandbox = RabbitSandbox | KafkaSandbox;

// `<<WORD` starts a heredoc; `<<< word` is a here-string (same rule as src/engine/sim/console.ts).
const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/;

/** Splits a script into logical commands: backslash continuations are joined, a heredoc keeps its body. Blank and comment lines are dropped. */
export function splitScript(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    while (line.endsWith('\\') && !line.endsWith('\\\\') && i + 1 < raw.length) line = `${line.slice(0, -1)} ${raw[++i].trimStart()}`;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = HEREDOC.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const body = [line];
    while (++i < raw.length) {
      body.push(raw[i]);
      if (raw[i].trim() === m[2]) break;
    }
    out.push(body.join('\n'));
  }
  return out;
}

function wire<M extends Model<S> & { setClock(advance: (ms: number) => void): void }, S>(model: M, scenario: Scenario | undefined, commands: (m: M) => ConsoleCommand[]): Sandbox<M, S> {
  const sim = new Sim<S>(model, { seed: scenario?.seed ?? 1 });
  model.setClock((ms) => void sim.runUntil(sim.now + ms));
  const con = createConsole(commands(model));
  return {
    model,
    sim,
    console: con,
    run(script) {
      return splitScript(script).map((command) => {
        const r = con.exec(command);
        return { line: command.split('\n')[0], exit: r.exit, output: r.lines.map((l) => l.text).join('\n') };
      });
    },
  };
}

export const createRabbitSandbox = (scenario?: Scenario): RabbitSandbox => wire(new RabbitModel(scenario), scenario, createRabbitCommands);
export const createKafkaSandbox = (scenario?: Scenario): KafkaSandbox => wire(new KafkaModel(scenario), scenario, createKafkaCommands);
export const createSandbox = (flavor: Flavor, scenario?: Scenario): AnySandbox => (flavor === 'kafka' ? createKafkaSandbox(scenario) : createRabbitSandbox(scenario));
