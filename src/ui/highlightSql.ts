const KEYWORDS = new Set(
  `select from where and or not in is null as on join left right inner full outer cross natural group by order having
  limit offset distinct insert into values update set delete create table index view primary key foreign references
  unique check default constraint alter add drop column cascade restrict explain analyze with recursive over partition
  case when then else end exists between like ilike union all intersect except begin commit rollback savepoint
  returning true false asc desc using lateral filter window rows range preceding following current row unbounded
  transaction isolation level read committed repeatable serializable if replace serial bigserial int integer bigint
  smallint text varchar char numeric decimal real double precision boolean date time timestamp interval jsonb json
  uuid materialized concurrently nulls first last generated always identity conflict do nothing`
    .split(/\s+/)
    .filter(Boolean),
);

const TOKEN = /(--[^\n]*)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([^-'A-Za-z0-9_]+|-)/g;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lightweight SQL colouring for static snippets (theory, review code); the editor uses Monaco's grammar. */
export function highlightSql(sql: string): string {
  let html = '';
  for (const [, comment, string, number, word, other] of sql.matchAll(TOKEN)) {
    if (comment) html += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
    else if (string) html += `<span class="tok-string">${escapeHtml(string)}</span>`;
    else if (number) html += `<span class="tok-number">${number}</span>`;
    else if (word) html += KEYWORDS.has(word.toLowerCase()) ? `<span class="tok-keyword">${word}</span>` : escapeHtml(word);
    else html += escapeHtml(other);
  }
  return html;
}
