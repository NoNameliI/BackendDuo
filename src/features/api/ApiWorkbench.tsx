import { useState, type ReactNode } from 'react';
import { Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';
import { CorsPanel } from './CorsPanel';
import { ExchangeDiagram } from './ExchangeDiagram';
import { GraphqlPanel } from './GraphqlPanel';
import { NetworkLog } from './NetworkLog';
import { ProtoPanel } from './ProtoPanel';
import { RequestComposer } from './RequestComposer';
import { ResponseView } from './ResponseView';

type Side = 'log' | 'diagram';
const SIDE = [
  { id: 'log', title: 'Лента запросов' },
  { id: 'diagram', title: 'Схема обмена' },
] as const;

/** Request composer, response, network log and exchange diagram of the sandbox in ApiSandboxContext. */
export function ApiWorkbench({ actions, prefix }: { actions: ReactNode; prefix: string }) {
  const [side, setSide] = useState<Side>('log');
  const mode = useApiSandbox()((s) => (s.cors ? 'cors' : s.graphql ? 'graphql' : s.proto ? 'proto' : 'http'));
  const top = { cors: ['CORS', <CorsPanel />], graphql: ['GraphQL', <GraphqlPanel />], proto: ['Protobuf', <ProtoPanel />], http: ['Запрос', <RequestComposer />] } as const;
  return (
    <Split direction="column" initial={[52, 48]} storageKey={`${prefix}-rows`}>
      <Panel title={top[mode][0]} actions={actions}>
        {top[mode][1]}
      </Panel>
      <Split direction="row" initial={[50, 50]} storageKey={`${prefix}-bottom`}>
        <Panel title="Ответ">
          <ResponseView />
        </Panel>
        <Panel tabs={<Tabs label="Сетевой обмен" items={SIDE} value={side} onChange={setSide} idPrefix={`${prefix}-side`} />}>
          <div id={`${prefix}-side-panel`} role="tabpanel" aria-labelledby={`${prefix}-side-tab-${side}`} className="h-full">
            {side === 'log' ? <NetworkLog /> : <ExchangeDiagram />}
          </div>
        </Panel>
      </Split>
    </Split>
  );
}
