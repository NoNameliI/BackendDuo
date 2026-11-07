import { Marked } from 'marked';
import { useMemo } from 'react';
import { escapeHtml, highlightSql } from './highlightSql';

// Course content is bundled with the app and trusted, so rendered HTML is inserted as is.
/** Custom fenced blocks: info string -> HTML; returning null keeps the plain code block. */
export type Fences = Readonly<Record<string, (body: string) => string | null>>;

export function createMarkdown(fences: Fences = {}): Marked {
  return new Marked({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const tag = lang?.split(/\s/)[0] ?? '';
        const custom = Object.prototype.hasOwnProperty.call(fences, tag) ? fences[tag](text) : null;
        if (custom !== null) return custom;
        const body = tag === 'sql' ? highlightSql(text) : escapeHtml(text);
        return `<pre class="md-code"><code>${body}</code></pre>`;
      },
    },
  });
}

const markdown = createMarkdown();

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
