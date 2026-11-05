import { cutOff } from '../isolate';
import { runSchemaOp, type SchemaOp } from './schemaOps';

// GraphQL queries and .proto files of the learner are only data here, yet they run apart from the UI:
// a huge query cannot freeze the window, and the worker has nothing to reach out with.
const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; op: SchemaOp; args: unknown[] }>) => void;
  postMessage: (message: unknown) => void;
};
cutOff(self);

scope.onmessage = ({ data: { id, op, args } }) => scope.postMessage(runSchemaOp(id, op, args));
