import Editor from '@monaco-editor/react';
import '@/ui/monaco/setup';
import { useResolvedTheme } from '@/app/useResolvedTheme';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function SqlEditor({ value, onChange, readOnly = false }: SqlEditorProps) {
  const theme = useResolvedTheme();
  return (
    <Editor
      language="pgsql"
      theme={theme === 'dark' ? 'studio-dark' : 'studio-light'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      loading={null}
      options={{
        ariaLabel: 'Редактор SQL',
        readOnly,
        fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
        fontSize: 14,
        lineHeight: 22,
        padding: { top: 12, bottom: 12 },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        lineNumbersMinChars: 3,
        folding: false,
        glyphMargin: false,
        renderLineHighlight: 'line',
        wordWrap: 'on',
        tabSize: 2,
        automaticLayout: true,
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
