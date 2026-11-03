import { describe, expect, it } from 'vitest';
import { splitTheory, theoryExamples } from './theory';

const fence = '```';

describe('splitTheory', () => {
  it('separates runnable examples from the surrounding Markdown', () => {
    const theory = `Вступление.\n\n${fence}sql example\nSELECT 1;\n${fence}\n\nШаблон:\n\n${fence}sql\nSELECT столбцы FROM таблица;\n${fence}\n\n${fence}sql example\nSELECT 2;\n${fence}`;
    expect(splitTheory(theory)).toEqual([
      { kind: 'markdown', text: 'Вступление.' },
      { kind: 'example', sql: 'SELECT 1;' },
      { kind: 'markdown', text: `Шаблон:\n\n${fence}sql\nSELECT столбцы FROM таблица;\n${fence}` },
      { kind: 'example', sql: 'SELECT 2;' },
    ]);
    expect(theoryExamples(theory)).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('returns plain theory unchanged', () => {
    expect(splitTheory('Только текст.')).toEqual([{ kind: 'markdown', text: 'Только текст.' }]);
    expect(splitTheory('')).toEqual([]);
  });
});
