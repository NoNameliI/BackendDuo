import Editor from '@monaco-editor/react';
import { useRef } from 'react';
import { useResolvedTheme } from '@/app/useResolvedTheme';
import { monaco } from '@/ui/monaco/setup';

interface CodeEditorProps {
  language: 'graphql' | 'protobuf' | 'python' | 'json';
  value: string;
  onChange?: (value: string) => void;
  ariaLabel: string;
  readOnly?: boolean;
  /** Ctrl+Enter inside the editor. */
  onRun?: () => void;
}

/** Monaco for the API course: GraphQL queries, .proto files, Python, JSON. */
export default function CodeEditor({ language, value, onChange, ariaLabel, readOnly = false, onRun }: CodeEditorProps) {
  const theme = useResolvedTheme();
  const runRef = useRef(onRun);
  runRef.current = onRun;
  return (
    <Editor
      language={language === 'json' ? 'javascript' : language}
      theme={theme === 'dark' ? 'studio-dark' : 'studio-light'}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={(editor) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
      }}
      loading={null}
      options={{
        ariaLabel,
        readOnly,
        domReadOnly: readOnly,
        fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
        fontSize: 13.5,
        lineHeight: 21,
        padding: { top: 10, bottom: 10 },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        lineNumbersMinChars: 3,
        folding: false,
        glyphMargin: false,
        wordWrap: 'on',
        tabSize: 2,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        wordBasedSuggestions: 'off',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
