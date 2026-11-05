/** Everything a worker could use to reach the network, other origins or storage. */
const OUTSIDE = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  // navigator.storage (persistent OPFS files) and navigator.locks; fonts load from any URL.
  'navigator',
  'FontFace',
  'fonts',
];

/**
 * Takes away every way to turn a string into JavaScript (eval, the Function constructors, string timers): such
 * code could call import() with any URL. The worker's own scripts are already loaded and keep working.
 */
export function noCodeFromStrings(scope: typeof globalThis): void {
  const refuse = () => {
    throw new EvalError('Выполнение JavaScript из строки отключено');
  };
  const constructors = [
    Function,
    Object.getPrototypeOf(async () => {}).constructor,
    Object.getPrototypeOf(function* () {}).constructor,
    Object.getPrototypeOf(async function* () {}).constructor,
  ] as FunctionConstructor[];
  // A proxy keeps `instanceof Function` and the prototype working (the runtime relies on them) but cannot build code.
  const locked = constructors.map((ctor) => new Proxy(ctor, { apply: refuse, construct: refuse }));
  constructors.forEach((ctor, i) => Object.defineProperty(ctor.prototype, 'constructor', { value: locked[i], writable: false, configurable: false }));
  Object.defineProperty(scope, 'eval', { value: refuse, writable: false, configurable: false });
  Object.defineProperty(scope, 'Function', { value: locked[0], writable: false, configurable: false });
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const timer = scope[name] as (handler: unknown, ...rest: unknown[]) => number;
    Object.defineProperty(scope, name, {
      value: (handler: unknown, ...rest: unknown[]) => (typeof handler === 'function' ? timer.call(scope, handler, ...rest) : refuse()),
      writable: false,
      configurable: false,
    });
  }
}

/**
 * Removes network, storage and nested-worker APIs from a worker's global scope, own properties and those
 * inherited from WorkerGlobalScope alike, so code running later (a learner's Python included) cannot get them back.
 */
export function cutOff(scope: object, extra: string[] = []): void {
  for (const name of [...OUTSIDE, ...extra]) {
    for (let obj: object | null = scope; obj; obj = Object.getPrototypeOf(obj)) {
      try {
        delete (obj as Record<string, unknown>)[name];
      } catch {
        /* not configurable: shadowed below */
      }
    }
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
    } catch {
      /* already locked */
    }
  }
}
