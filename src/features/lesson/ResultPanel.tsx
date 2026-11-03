import { EmptyState, Panel } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';
import { PlanView } from './PlanView';
import { ResultTable } from './ResultTable';
import { SchemaView } from './SchemaView';
import { useWorkspace } from './workspace';

const tabs = [
  { id: 'result', title: 'Результат' },
  { id: 'schema', title: 'Схема' },
  { id: 'plan', title: 'План' },
] as const;

export function ResultPanel() {
  const { tab, setTab, result, schema, plan } = useWorkspace();
  return (
    <Panel tabs={<Tabs label="Вывод" items={tabs} value={tab} onChange={setTab} idPrefix="result" />}>
      <div id="result-panel" role="tabpanel" aria-labelledby={`result-tab-${tab}`} className="h-full">
        {tab === 'result' &&
          (result ? <ResultTable result={result} /> : <EmptyState>Выполните запрос, чтобы увидеть результат.</EmptyState>)}
        {tab === 'schema' && <SchemaView schema={schema} />}
        {tab === 'plan' && <PlanView plan={plan} />}
      </div>
    </Panel>
  );
}
