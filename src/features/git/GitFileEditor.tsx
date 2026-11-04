import Editor from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '@/app/useResolvedTheme';
import { monaco } from '@/ui/monaco/setup';
import { displayPath } from '@/engine/git/world';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Panel';
import { useSandbox } from './gitSandbox';

const LANGUAGES: Record<string, string> = {
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  js: 'javascript',
  ts: 'javascript',
  json: 'javascript',
  css: 'css',
  html: 'html',
  sh: 'shell',
  ini: 'ini',
  toml: 'ini',
  sql: 'pgsql',
};

const languageOf = (path: string) => LANGUAGES[path.split('.').pop()!.toLowerCase()] ?? 'plaintext';

/** Text editor for files of the sandbox; saving writes the file into the sandbox, like a real editor would. */
export default function GitFileEditor() {
  const useGitSandbox = useSandbox();
  const theme = useResolvedTheme();
  const path = useGitSandbox((s) => s.openFile);
  const engine = useGitSandbox((s) => s.engine);
  const version = useGitSandbox((s) => s.version);
  const saveFile = useGitSandbox((s) => s.saveFile);
  const saved = path ? engine.world.files.get(path) : undefined;
  const [draft, setDraft] = useState(saved ?? '');
  const saveRef = useRef<() => void>(() => {});

  // A command may change or delete the open file (checkout, restore, rm): show what is on disk now.
  useEffect(() => setDraft(saved ?? ''), [path, saved, version]);

  if (!path) return <EmptyState>Выберите файл слева, чтобы открыть его. Изменения сохраняются в песочнице по Ctrl+S.</EmptyState>;
  if (saved === undefined) return <EmptyState>Файл {displayPath(path)} удалён из рабочей папки.</EmptyState>;
  const dirty = draft !== saved;
  const save = () => saveFile(path, draft.endsWith('\n') || draft === '' ? draft : `${draft}\n`);
  saveRef.current = save;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 font-mono text-[12px] text-dim">
        <span className="truncate">{displayPath(path)}</span>
        {dirty && <span className="text-amber">● не сохранено</span>}
        <Button className="ml-auto" disabled={!dirty} onClick={save} shortcut="Ctrl+S">
          Сохранить
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={path}
          language={languageOf(path)}
          theme={theme === 'dark' ? 'studio-dark' : 'studio-light'}
          value={draft}
          onChange={(v) => setDraft(v ?? '')}
          onMount={(editor) => {
            // Monaco swallows the key, so the browser's own "save page" never opens.
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
          }}
          loading={null}
          options={{
            ariaLabel: `Редактор файла ${displayPath(path)}`,
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
            fontSize: 13.5,
            lineHeight: 21,
            padding: { top: 10, bottom: 10 },
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbersMinChars: 3,
            folding: false,
            glyphMargin: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
            fixedOverflowWidgets: true,
            wordBasedSuggestions: 'off',
            quickSuggestions: false,
            renderWhitespace: 'trailing',
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
        />
      </div>
    </div>
  );
}
