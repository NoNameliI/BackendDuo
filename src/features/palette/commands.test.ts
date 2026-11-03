import { describe, expect, it } from 'vitest';
import { filterCommands, type Command } from './commands';

const cmd = (title: string, hint = '', group = 'Уроки'): Command => ({ id: title, title, hint, group, run: () => {} });

describe('filterCommands', () => {
  const commands = [cmd('Первая таблица', 'Мир 1'), cmd('Индекс B-Tree', 'Мир 5'), cmd('Профиль', '', 'Разделы'), cmd('Ёлочные игрушки')];

  it('matches every word case-insensitively, treating ё as е', () => {
    expect(filterCommands(commands, 'ТАБЛ мир').map((c) => c.title)).toEqual(['Первая таблица']);
    expect(filterCommands(commands, 'елоч').map((c) => c.title)).toEqual(['Ёлочные игрушки']);
    expect(filterCommands(commands, 'разделы').map((c) => c.title)).toEqual(['Профиль']);
  });

  it('returns everything for an empty query, within the limit', () => {
    expect(filterCommands(commands, '  ', 2)).toHaveLength(2);
  });
});
