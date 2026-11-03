import type { WorkerRequest, WorkerResponse } from '../WorkerEngine';
import { PostgresEngine } from './PostgresEngine';

const engine = new PostgresEngine();
const scope = self as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    const value = await (engine[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    scope.postMessage({ id, ok: true, value });
  } catch (e) {
    scope.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
