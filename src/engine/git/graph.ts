/**
 * Port of the line-drawing state machine behind `git log --graph` (git's graph.c), without colors and
 * octopus merges. Every line is padded to the graph width, exactly like git, so output matches byte for byte.
 */
type State = 'padding' | 'skip' | 'commit' | 'postMerge' | 'collapsing';

const MERGE_CHARS = ['/', '|', '\\'];

export class Graph {
  private commit = '';
  private parents: string[] = [];
  private width = 0;
  private state: State = 'padding';
  private prevState: State = 'padding';
  private commitIndex = 0;
  private prevCommitIndex = 0;
  private mergeLayout = 0;
  private edgesAdded = 0;
  private prevEdgesAdded = 0;
  private columns: string[] = [];
  private newColumns: string[] = [];
  private mapping: number[] = [];
  private oldMapping: number[] = [];
  private mappingSize = 0;

  constructor(private readonly parentsOf: (id: string) => string[]) {}

  get finished(): boolean {
    return this.state === 'padding';
  }

  update(commit: string): void {
    this.commit = commit;
    this.parents = this.parentsOf(commit);
    this.prevCommitIndex = this.commitIndex;
    this.updateColumns();
    this.setState(this.state !== 'padding' ? 'skip' : 'commit');
  }

  private setState(s: State): void {
    this.prevState = this.state;
    this.state = s;
  }

  private updateColumns(): void {
    this.columns = this.newColumns;
    this.newColumns = [];
    const max = this.columns.length + this.parents.length;
    this.mappingSize = 2 * max;
    this.mapping = new Array(this.mappingSize).fill(-1);
    this.oldMapping = this.oldMapping.length >= this.mappingSize ? this.oldMapping : [...this.oldMapping, ...new Array(this.mappingSize - this.oldMapping.length).fill(-1)];
    this.width = 0;
    this.prevEdgesAdded = this.edgesAdded;
    this.edgesAdded = 0;
    let seen = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seen) break;
        colCommit = this.commit;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seen = true;
        this.commitIndex = i;
        this.mergeLayout = -1;
        for (const p of this.parents) this.insert(p, i);
        if (this.parents.length === 0) this.width += 2;
      } else this.insert(colCommit, -1);
    }
    while (this.mappingSize > 1 && this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
  }

  private insert(commit: string, idx: number): void {
    let i = this.newColumns.indexOf(commit);
    if (i < 0) {
      i = this.newColumns.length;
      this.newColumns.push(commit);
    }
    let at: number;
    if (this.parents.length > 1 && idx > -1 && this.mergeLayout === -1) {
      const dist = idx - i;
      const shift = dist > 1 ? 2 * dist - 3 : 1;
      this.mergeLayout = dist > 0 ? 0 : 1;
      this.edgesAdded = this.parents.length + this.mergeLayout - 2;
      at = this.width + (this.mergeLayout - 1) * shift;
      this.width += 2 * this.mergeLayout;
    } else if (this.edgesAdded > 0 && i === this.mapping[this.width - 2]) {
      at = this.width - 2;
      this.edgesAdded = -1;
    } else {
      at = this.width;
      this.width += 2;
    }
    this.mapping[at] = i;
  }

  private mappingCorrect(): boolean {
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i];
      if (target >= 0 && target !== Math.floor(i / 2)) return false;
    }
    return true;
  }

  /** The next graph line (without text); true in `commit` when it is the line of the commit itself. */
  next(): { line: string; commit: boolean } {
    let line = '';
    let commit = false;
    switch (this.state) {
      case 'padding':
        line = this.newColumns.map(() => '| ').join('');
        break;
      case 'skip':
        line = '...';
        this.setState('commit');
        break;
      case 'commit':
        line = this.commitLine();
        commit = true;
        break;
      case 'postMerge':
        line = this.postMergeLine();
        break;
      case 'collapsing':
        line = this.collapsingLine();
        break;
    }
    return { line: line.padEnd(this.width), commit };
  }

  /** The line printed between two commits in the full format. */
  separator(): string {
    if (this.state !== 'commit') return this.next().line;
    const line = this.columns.map(() => '| ').join('');
    this.prevState = 'padding';
    return line.padEnd(this.width);
  }

  private commitLine(): string {
    let line = '';
    let seen = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seen) break;
        colCommit = this.commit;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seen = true;
        line += '*';
      } else if (seen && this.edgesAdded > 1) line += '\\';
      else if (seen && this.edgesAdded === 1) {
        line += this.prevState === 'postMerge' && this.prevEdgesAdded > 0 && this.prevCommitIndex < i ? '\\' : '|';
      } else if (this.prevState === 'collapsing' && this.oldMapping[2 * i + 1] === i && this.mapping[2 * i] < i) line += '/';
      else line += '|';
      line += ' ';
    }
    if (this.parents.length > 1) this.setState('postMerge');
    else this.setState(this.mappingCorrect() ? 'padding' : 'collapsing');
    return line;
  }

  private postMergeLine(): string {
    let line = '';
    let seen = false;
    let parentCol: string | null = null;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seen) break;
        colCommit = this.commit;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seen = true;
        let idx = this.mergeLayout;
        this.parents.forEach((_, j) => {
          line += MERGE_CHARS[idx];
          if (idx === 2) {
            if (this.edgesAdded > 0 || j < this.parents.length - 1) line += ' ';
          } else idx++;
        });
        if (this.edgesAdded === 0) line += ' ';
      } else if (seen) {
        line += this.edgesAdded > 0 ? '\\ ' : '| ';
      } else {
        line += '|';
        if (this.mergeLayout !== 0 || i !== this.commitIndex - 1) line += parentCol ? '_' : ' ';
      }
      if (colCommit === this.parents[0]) parentCol = colCommit;
    }
    this.setState(this.mappingCorrect() ? 'padding' : 'collapsing');
    return line;
  }

  private collapsingLine(): string {
    let usedHorizontal = false;
    let horizontalEdge = -1;
    let horizontalTarget = -1;
    [this.mapping, this.oldMapping] = [this.oldMapping, this.mapping];
    for (let i = 0; i < this.mappingSize; i++) this.mapping[i] = -1;
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.oldMapping[i];
      if (target < 0) continue;
      if (target * 2 === i) this.mapping[i] = target;
      else if (this.mapping[i - 1] < 0) {
        this.mapping[i - 1] = target;
        if (horizontalEdge === -1) {
          horizontalEdge = i;
          horizontalTarget = target;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      } else if (this.mapping[i - 1] !== target) {
        this.mapping[i - 2] = target;
        if (horizontalEdge === -1) {
          horizontalTarget = target;
          horizontalEdge = i - 1;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      }
    }
    for (let i = 0; i < this.mappingSize; i++) this.oldMapping[i] = this.mapping[i];
    if (this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
    let line = '';
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i];
      if (target < 0) line += ' ';
      else if (target * 2 === i) line += '|';
      else if (target === horizontalTarget && i !== horizontalEdge - 1) {
        if (i !== target * 2 + 3) this.mapping[i] = -1;
        usedHorizontal = true;
        line += '_';
      } else {
        if (usedHorizontal && i < horizontalEdge) this.mapping[i] = -1;
        line += '/';
      }
    }
    if (this.mappingCorrect()) this.setState('padding');
    return line;
  }
}

/** Lays out commits with their text lines the way `git log --graph` prints them. */
export function drawGraph(ids: string[], parentsOf: (id: string) => string[], text: (id: string) => string[], separated: boolean): string[] {
  const graph = new Graph(parentsOf);
  const out: string[] = [];
  ids.forEach((id, n) => {
    graph.update(id);
    if (separated && n > 0) out.push(graph.separator());
    const [first, ...rest] = text(id);
    for (;;) {
      const { line, commit } = graph.next();
      if (commit) {
        out.push(line + first);
        break;
      }
      out.push(line);
      if (graph.finished) break;
    }
    for (const line of rest) out.push(graph.next().line + line);
    while (!graph.finished) out.push(graph.next().line);
  });
  return out;
}
