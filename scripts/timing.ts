// Time budgets of speed tests. The full `npm test` runs many workers at once (several boot Pyodide), so wall-clock
// limits there are four times looser and catch only gross slowdowns; `npm run test:timing` runs the speed tests alone
// with STRICT_TIMING=1 and the real limits.
export const strictTiming = process.env.STRICT_TIMING === '1';

export const budget = (ms: number): number => (strictTiming ? ms : ms * 4);
