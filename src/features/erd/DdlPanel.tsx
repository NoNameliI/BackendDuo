import { useWorkspace } from '@/features/lesson/workspace';
import { highlightSql } from '@/ui/highlightSql';
import { EmptyState, Panel } from '@/ui/Panel';

/** Read-only view of the DDL built from the diagram; this is what the check runs. */
export function DdlPanel() {
  const code = useWorkspace((s) => s.code);
  return (
    <Panel title="Сгенерированный SQL">
      {code.trim() ? (
        <pre
          className="h-full overflow-auto bg-well p-3 font-mono text-[12.5px] leading-[1.7]"
          dangerouslySetInnerHTML={{ __html: highlightSql(code) }}
        />
      ) : (
        <EmptyState>Добавьте таблицу — здесь появится её CREATE TABLE.</EmptyState>
      )}
    </Panel>
  );
}
