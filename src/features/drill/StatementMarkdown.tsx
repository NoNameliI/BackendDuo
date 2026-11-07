import { useMemo } from 'react';
import { createMarkdown } from '@/ui/Markdown';
import { graphFigure } from './graphFigure';

const markdown = createMarkdown({ graph: graphFigure });

/** Markdown of drill statements: same as the shared one plus ```graph figures. */
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const html = useMemo(() => markdown.parse(source, { async: false }), [source]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
