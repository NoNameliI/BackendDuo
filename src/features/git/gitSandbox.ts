import { create } from 'zustand';
import { prompt } from '@/engine/git/complete';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import type { OutputLine } from '@/engine/git/shell';

export interface TerminalEntry {
  id: number;
  prompt: string;
  command: string;
  lines: OutputLine[];
}

interface GitSandboxState {
  engine: GitSandboxEngine;
  /** Bumped after every change of the sandbox, so views re-read it. */
  version: number;
  entries: TerminalEntry[];
  history: string[];
  openFile: string | null;
  run: (command: string) => number;
  reset: (setup: string, cwd?: string) => void;
  saveFile: (path: string, content: string) => void;
  setOpenFile: (path: string | null) => void;
  /** Re-renders views after a change made outside the terminal (hosting pages). */
  touch: () => void;
}

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

export const useGitSandbox = create<GitSandboxState>((set, get) => ({
  engine: new GitSandboxEngine(),
  version: 0,
  entries: [],
  history: [],
  openFile: null,
  run: (command) => {
    const { engine, entries, history, version } = get();
    const before = prompt(engine.world);
    const result = engine.run(command);
    const entry = { id: nextId++, prompt: before, command, lines: result.lines };
    set({
      entries: result.clear ? [] : [...entries, entry].slice(-MAX_ENTRIES),
      history: command.trim() && history.at(-1) !== command ? [...history, command].slice(-200) : history,
      version: version + 1,
    });
    return result.exit;
  },
  reset: (setup, cwd) => {
    const engine = new GitSandboxEngine();
    engine.reset(setup);
    if (cwd) engine.world.cwd = cwd;
    set({ engine, entries: [], version: get().version + 1, openFile: null });
  },
  saveFile: (path, content) => {
    get().engine.world.writeFile(path, content);
    set({ version: get().version + 1 });
  },
  setOpenFile: (openFile) => set({ openFile }),
  touch: () => set({ version: get().version + 1 }),
}));
