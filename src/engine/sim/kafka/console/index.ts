import type { ConsoleCommand } from '../../console';
import type { KafkaModel } from '../model';
import { createConfigsCommands } from './configs';
import { createConsumerCommands } from './consumer';
import { createGroupsCommands } from './groups';
import { createProducerCommands } from './producer';
import { createSimCommand } from './sim';
import { createTopicsCommands } from './topics';

/** `kafka-topics`, `kafka-console-producer`, `kafka-console-consumer`, `kafka-consumer-groups`, `kafka-configs` (each with and without `.sh`) and the teaching-only `sim`. */
export function createKafkaCommands(api: KafkaModel): ConsoleCommand[] {
  return [
    ...createTopicsCommands(api),
    ...createProducerCommands(api),
    ...createConsumerCommands(api),
    ...createGroupsCommands(api),
    ...createConfigsCommands(api),
    createSimCommand(api),
  ];
}
