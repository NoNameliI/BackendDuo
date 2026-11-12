/** Rule registry type shared by the Rabbit and Kafka models (`rabbit/rules.ts`, `kafka/rules.ts`). */
export type RuleId = string;

export interface RuleInfo {
  /** Link to the documentation page the rule comes from. */
  url: string;
  /** One Russian line shown in explanations. */
  ru: string;
  status: 'exact' | 'simplified';
}

export type RuleRegistry = Record<RuleId, RuleInfo>;

/** Markdown table for docs/engine-differences.md, rows sorted by id. */
export function rulesMarkdown(reg: RuleRegistry): string {
  const rows = Object.keys(reg)
    .sort()
    .map((id) => {
      const r = reg[id];
      return `| \`${id}\` | ${r.ru} | ${r.status === 'exact' ? 'точно' : 'упрощено'} | ${r.url} |`;
    });
  return ['| Правило | Описание | Статус | Источник |', '|---|---|---|---|', ...rows].join('\n');
}
