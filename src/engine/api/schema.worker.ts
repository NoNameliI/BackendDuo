import { runSchemaOp, type SchemaOp } from './schemaOps';

// GraphQL queries and .proto files of the learner are only data here, yet they run apart from the UI:
// a huge query cannot freeze the window, and the worker has nothing to reach out with.
const scope = self as unknown as Record<string, unknown> & {
  onmessage: (event: MessageEvent<{ id: number; op: SchemaOp; args: unknown[] }>) => void;
  postMessage: (message: unknown) => void;
};
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches']) {
  try {
    delete scope[name];
    scope[name] = undefined;
  } catch {
    /* not configurable here */
  }
}

scope.onmessage = ({ data: { id, op, args } }) => scope.postMessage(runSchemaOp(id, op, args));
