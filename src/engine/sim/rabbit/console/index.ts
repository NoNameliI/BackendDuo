import type { ConsoleCommand } from '../../console';
import { createAdminCommand } from './admin';
import { newSession, type ConsoleSession, type RabbitConsoleApi } from './api';
import { createCtlCommands } from './ctl';
import { createSimCommand } from './sim';

export type { RabbitConsoleApi, ConsoleSession } from './api';

/** `rabbitmqadmin`, `rabbitmqctl`, `lq` and the teaching-only `sim`, ready for `createConsole`. */
export function createRabbitCommands(api: RabbitConsoleApi, session: ConsoleSession = newSession()): ConsoleCommand[] {
  const real: ConsoleCommand[] = [createAdminCommand(api, session), ...createCtlCommands(api)];
  const byName = new Map(real.map((c) => [c.name, c]));
  const dispatch = (name: string, args: string[]) => byName.get(name)?.run(args);
  return [...real, createSimCommand(api, session, dispatch)];
}
