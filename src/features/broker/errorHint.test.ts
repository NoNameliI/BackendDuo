import { describe, expect, it } from 'vitest';
import type { Course } from '@/content/loadCourse';
import { consoleHint } from './errorHint';

const course = { errorHints: { '404': 'нет такой очереди', '3': 'нет топика' } } as unknown as Course;

describe('consoleHint', () => {
  it('looks up the exact code only', () => {
    expect(consoleHint(course, '404')).toBe('нет такой очереди');
    expect(consoleHint(course, '3')).toBe('нет топика');
    expect(consoleHint(course, '40')).toBeUndefined();
    expect(consoleHint(course, undefined)).toBeUndefined();
  });
});
