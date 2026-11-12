import type { Journal, JournalDraft, JournalEntry, JournalFilter, Ms } from './types';

export const JOURNAL_CAP = 50_000;

/** Kinds hidden by the `important` filter. */
const ROUTINE = new Set(['publish', 'route', 'deliver', 'ack', 'produce', 'append', 'replicate', 'fetch', 'commit', 'assign']);

export interface JournalWriter extends Journal {
  add(at: Ms, draft: JournalDraft): void;
}

export function createJournal(): JournalWriter {
  const list: JournalEntry[] = [];
  let full = false;
  return {
    entries: () => list,
    add(at, draft) {
      if (full) return;
      if (list.length >= JOURNAL_CAP) {
        full = true;
        list.push({
          seq: list.length,
          at,
          kind: 'sim.limit',
          actor: 'sim',
          text: `Журнал переполнен: после ${JOURNAL_CAP} записей новые не сохраняются`,
        });
        return;
      }
      list.push({ ...draft, seq: list.length, at });
    },
    filter(f: JournalFilter) {
      return list.filter(
        (e) =>
          (!f.kinds || f.kinds.includes(e.kind)) &&
          (f.actor === undefined || e.actor === f.actor) &&
          (f.subject === undefined || e.subject === f.subject) &&
          (f.msg === undefined || e.msg === f.msg) &&
          (f.from === undefined || e.at >= f.from) &&
          (f.to === undefined || e.at <= f.to) &&
          (!f.important || !ROUTINE.has(e.kind)),
      );
    },
  };
}
