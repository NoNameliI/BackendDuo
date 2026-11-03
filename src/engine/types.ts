/** Contract every sandbox engine (one per course technology) implements. */
export interface SandboxEngine {
  init(): Promise<void>;
  /** Returns the database to a pristine state and applies the setup script. Throws if the setup fails. */
  reset(setupSql: string): Promise<void>;
  /** Runs one or more statements in order and stops at the first error. Never throws for SQL errors. */
  execute(sql: string): Promise<ExecOutcome>;
  /** Explains the last statement of `sql` without executing the statements before it. */
  explain(sql: string, options?: { analyze?: boolean }): Promise<ExplainOutcome>;
  introspect(): Promise<SchemaInfo>;
  dispose(): Promise<void>;
}

export type EngineMethod = Exclude<keyof SandboxEngine, 'dispose'>;

export interface ResultColumn {
  name: string;
  typeId: number;
  type: string;
}

/** Values are PostgreSQL's canonical text output (`null` for NULL), as psql shows them. */
export type Cell = string | null;

export interface StatementResult {
  sql: string;
  command: string;
  columns: ResultColumn[];
  rows: Cell[][];
  rowCount: number;
}

export interface SqlError {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  /** 1-based offsets into the submitted text. */
  position?: number;
  line?: number;
  column?: number;
  statementIndex?: number;
}

export interface ExecOutcome {
  results: StatementResult[];
  error?: SqlError;
  notices: string[];
  durationMs: number;
}

export interface PlanNode {
  type: string;
  relation?: string;
  alias?: string;
  index?: string;
  startupCost: number;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  actualTimeMs?: number;
  loops?: number;
  details: Record<string, string>;
  children: PlanNode[];
}

export interface QueryPlan {
  root: PlanNode;
  analyzed: boolean;
  planningTimeMs?: number;
  executionTimeMs?: number;
}

export type ExplainOutcome = { plan: QueryPlan; error?: undefined } | { plan?: undefined; error: SqlError };

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  identity: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
}

export interface IndexInfo {
  name: string;
  method: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
  definition: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: 'table' | 'view';
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  uniques: { name: string; columns: string[] }[];
  checks: { name: string; definition: string }[];
  indexes: IndexInfo[];
}

export interface SchemaInfo {
  tables: TableInfo[];
}
