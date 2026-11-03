import { describe, expect, it } from 'vitest';
import { highlightSql } from './highlightSql';

describe('highlightSql', () => {
  it('wraps keywords, strings, numbers and comments and escapes HTML', () => {
    expect(highlightSql(`SELECT name FROM t WHERE a < 10 AND b = 'x''y' -- note <b>`)).toBe(
      '<span class="tok-keyword">SELECT</span> name <span class="tok-keyword">FROM</span> t ' +
        '<span class="tok-keyword">WHERE</span> a &lt; <span class="tok-number">10</span> ' +
        '<span class="tok-keyword">AND</span> b = <span class="tok-string">\'x\'\'y\'</span> ' +
        '<span class="tok-comment">-- note &lt;b&gt;</span>',
    );
  });

  it('keeps identifiers containing digits intact', () => {
    expect(highlightSql('a5 - 2')).toBe('a5 - <span class="tok-number">2</span>');
  });
});
