import { Marked } from 'marked';
import { useMemo } from 'react';
import { escapeHtml, highlightSql } from './highlightSql';

// Course content is bundled with the app and trusted, so rendered HTML is inserted as is.
const markdown = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const body = lang === 'sql' ? highlightSql(text) : escapeHtml(text);
      return `<pre class="md-code"><code>${body}</code></pre>`;
    },
  },
});

export function renderMarkdown(source: string): string {
  return markdown.parse(source, { async: false });
}

export function renderInline(source: string): string {
  return markdown.parseInline(source, { async: false });
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InlineMarkdown({ source }: { source: string }) {
  const html = useMemo(() => renderInline(source), [source]);
  return <span className="md-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}
