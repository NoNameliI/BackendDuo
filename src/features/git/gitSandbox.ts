import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CommandRecord } from '@/checker/git';
import { prompt } from '@/engine/git/complete';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import type { OutputLine } from '@/engine/git/shell';

export interface TerminalEntry {
  id: number;
  prompt: string;
  command: string;
  lines: OutputLine[];
  /** Course explanation for an error in the output. */
  hint?: string;
}

export interface TerminalHint {
  pattern: RegExp;
  hint: string;
}

export interface GitSandboxState {
  engine: GitSandboxEngine;
  /** Bumped after every change of the sandbox, so views re-read it. */
  version: number;
  entries: TerminalEntry[];
  history: string[];
  /** Commands typed since the last reset, with exit codes (checked by "commands" tasks). */
  commands: CommandRecord[];
  hints: TerminalHint[];
  openFile: string | null;
  run: (command: string) => number;
  reset: (setup: string, cwd?: string) => void;
  setHints: (hints: TerminalHint[]) => void;
  saveFile: (path: string, content: string) => void;
  setOpenFile: (path: string | null) => void;
  /** Re-renders views after a change made outside the terminal (hosting pages). */
  touch: () => void;
}

export type GitSandboxStore = UseBoundStore<StoreApi<GitSandboxState>>;

let nextId = 1;
const MAX_ENTRIES = 300;

export const PLAYGROUND_SETUP = `mkdir -p site/css
cd site
cat > index.html <<'EOF'
<!doctype html>
<title>Мой сайт</title>
<link rel="stylesheet" href="css/style.css">
<h1>Привет!</h1>
EOF
cat > css/style.css <<'EOF'
body { font-family: sans-serif; }
EOF
cat > README.md <<'EOF'
# Мой сайт

Учебный проект для песочницы Git.
EOF`;

/** One Git sandbox with its terminal; the free playground and the lesson each have their own. */
export function createGitSandboxStore(): GitSandboxStore {
  return create<GitSandboxState>((set, get) => ({
    engine: new GitSandboxEngine(),
    version: 0,
    entries: [],
    history: [],
    commands: [],
    hints: [],
    openFile: null,
    run: (command) => {
      const { engine, entries, history, version, commands, hints } = get();
      const before = prompt(engine.world);
      const result = engine.run(command);
      const errorLine = result.exit !== 0 ? result.lines.find((l) => hints.some((h) => h.pattern.test(l.text))) : undefined;
      const hint = errorLine ? hints.find((h) => h.pattern.test(errorLine.text))?.hint : undefined;
      const entry = { id: nextId++, prompt: before, command, lines: result.lines, hint };
      set({
        entries: result.clear ? [] : [...entries, entry].slice(-MAX_ENTRIES),
        history: command.trim() && history.at(-1) !== command ? [...history, command].slice(-200) : history,
        commands: command.trim() ? [...commands, { line: command.trim(), exit: result.exit }] : commands,
        version: version + 1,
      });
      return result.exit;
    },
    reset: (setup, cwd) => {
      const engine = new GitSandboxEngine();
      engine.reset(setup);
      if (cwd) engine.world.cwd = cwd;
      set({ engine, entries: [], commands: [], version: get().version + 1, openFile: null });
    },
    setHints: (hints) => set({ hints }),
    saveFile: (path, content) => {
      get().engine.world.writeFile(path, content);
      set({ version: get().version + 1 });
    },
    setOpenFile: (openFile) => set({ openFile }),
    touch: () => set({ version: get().version + 1 }),
  }));
}

/** The free sandbox of the "Песочница Git" screen. */
export const playgroundSandbox = createGitSandboxStore();

export const SandboxContext = createContext<GitSandboxStore>(playgroundSandbox);

/** The sandbox the surrounding screen works with. */
export const useSandbox = (): GitSandboxStore => useContext(SandboxContext);
