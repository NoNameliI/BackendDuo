import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { SqlError } from '@/engine';
import { monaco } from '@/ui/monaco/setup';
import { useResolvedTheme } from '@/app/useResolvedTheme';
import { completionsAt } from './completion';
import { useWorkspace } from './workspace';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  error?: SqlError | null;
  readOnly?: boolean;
}

const KIND = {
  table: monaco.languages.CompletionItemKind.Struct,
  column: monaco.languages.CompletionItemKind.Field,
  function: monaco.languages.CompletionItemKind.Function,
  keyword: monaco.languages.CompletionItemKind.Keyword,
};

// Registered once: suggestions follow the schema of the current task's database.
monaco.languages.registerCompletionItemProvider('pgsql', {
  triggerCharacters: ['.'],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const textBefore = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column));
    const items = completionsAt(textBefore, model.getValue(), useWorkspace.getState().schema);
    return {
      suggestions: items.map((item, i) => ({
        label: item.label,
        kind: KIND[item.kind],
        detail: item.detail,
        insertText: item.label,
        range,
        sortText: `${item.kind === 'keyword' ? 3 : item.kind === 'function' ? 2 : item.kind === 'table' ? 0 : 1}${String(i).padStart(4, '0')}`,
      })),
    };
  },
});

export default function SqlEditor({ value, onChange, error, readOnly = false }: SqlEditorProps) {
  const theme = useResolvedTheme();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    if (!error?.line || !error.column) {
      monaco.editor.setModelMarkers(model, 'sandbox', []);
      return;
    }
    const line = Math.min(error.line, model.getLineCount());
    const word = model.getWordAtPosition({ lineNumber: line, column: error.column });
    monaco.editor.setModelMarkers(model, 'sandbox', [
      {
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: line,
        startColumn: error.column,
        endLineNumber: line,
        endColumn: word ? word.endColumn : error.column + 1,
      },
    ]);
  }, [error]);

  return (
    <Editor
      language="pgsql"
      theme={theme === 'dark' ? 'studio-dark' : 'studio-light'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor) => {
        editorRef.current = editor;
      }}
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
        wordBasedSuggestions: 'off',
        quickSuggestions: { other: true, comments: false, strings: false },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
