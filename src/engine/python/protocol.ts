import type { ApiRequest } from '@/engine/api/http';
import type { ClientSetup } from './brokerBridge';

/** Requests to the Python worker; they travel over a private MessagePort, never the worker's own postMessage. */
export type PythonRequest =
  | { id: number; op: 'init' }
  | { id: number; op: 'run'; source: string; requests: ApiRequest[]; keep: boolean }
  | { id: number; op: 'script'; source: string; files: Record<string, string> }
  | { id: number; op: 'client'; source: string; setup: ClientSetup }
  | { id: number; op: 'forget' };

/** `fatal`: Pyodide itself broke (for example, the WebAssembly stack overflowed) and the worker must be replaced. */
export type PythonReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string; fatal?: boolean };

/** The first and only message on the worker's own channel: it carries the port for everything else. */
export const CONNECT = 'connect';
