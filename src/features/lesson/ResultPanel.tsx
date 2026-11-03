import { useState } from 'react';
import { EmptyState, Panel } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';

type ResultTab = 'result' | 'schema' | 'plan';

const tabs = [
  { id: 'result', title: 'Результат' },
  { id: 'schema', title: 'Схема' },
  { id: 'plan', title: 'План' },
] as const;

export function ResultPanel() {
  const [tab, setTab] = useState<ResultTab>('result');
  return (
    <Panel tabs={<Tabs label="Вывод" items={tabs} value={tab} onChange={setTab} idPrefix="result" />}>
      <div id="result-panel" role="tabpanel" aria-labelledby={`result-tab-${tab}`} className="h-full">
        {tab === 'result' && <EmptyState>Выполните запрос, чтобы увидеть результат.</EmptyState>}
        {tab === 'schema' && <EmptyState>Здесь появится схема таблиц задания.</EmptyState>}
        {tab === 'plan' && <EmptyState>Здесь появится план выполнения запроса.</EmptyState>}
      </div>
    </Panel>
  );
}
