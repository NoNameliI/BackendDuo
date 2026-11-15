// `npm run test:timing`: the speed tests alone, one worker, with the strict limits of scripts/timing.ts.
import { spawnSync } from 'node:child_process';

const files = [
  'src/engine/drill/generators.test.ts',
  'src/engine/drill/gen/shared/graphLayout.test.ts',
  'src/checker/broker.test.ts',
  'src/checker/brokerKafka.test.ts',
];
const result = spawnSync('npx', ['vitest', 'run', ...files, '--maxWorkers=1'], { stdio: 'inherit', shell: true, env: { ...process.env, STRICT_TIMING: '1' } });
process.exit(result.status ?? 1);
