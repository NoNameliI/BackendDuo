import { findHeader, splitUrl, statusText, type Exchange } from '@/engine/api/http';
import { EmptyState } from '@/ui/Panel';
import { useApiSandbox } from './apiStore';
import { useSelectedExchange } from './ResponseView';

const W = 520;
const LEFT = 90;
const RIGHT = W - 90;
const STEP = 74;

function host(e: Exchange): string {
  const origin = splitUrl(e.request.url).origin;
  return origin ? origin.replace(/^https?:\/\//, '') : 'учебный сервер';
}

/** Sequence diagram of one send: client and server lifelines, request and response arrows. */
export function ExchangeDiagram() {
  const useStore = useApiSandbox();
  const exchanges = useStore((s) => s.exchanges);
  const current = useSelectedExchange();
  if (!current) return <EmptyState>Здесь появится схема обмена: кто кому что отправил и что получил в ответ.</EmptyState>;
  const steps = exchanges.filter((e) => e.group !== undefined && e.group === current.group);
  const shown = steps.length ? steps : [current];
  const client = current.origin ? `страница ${current.origin.replace(/^https?:\/\//, '')}` : 'клиент';
  const height = 60 + shown.length * STEP * 2;

  return (
    <div className="h-full overflow-auto p-3">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Схема обмена между клиентом и сервером" className="max-w-[560px] font-mono text-[12px]">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--dim)" />
          </marker>
        </defs>
        {[
          [LEFT, client],
          [RIGHT, host(current)],
        ].map(([x, label]) => (
          <g key={String(x)}>
            <rect x={Number(x) - 78} y={4} width={156} height={26} rx={4} fill="var(--raised)" stroke="var(--line-strong)" />
            <text x={Number(x)} y={21} textAnchor="middle" fill="var(--fg)">
              {String(label).length > 22 ? `${String(label).slice(0, 21)}…` : label}
            </text>
            <line x1={Number(x)} x2={Number(x)} y1={30} y2={height - 4} stroke="var(--line-strong)" strokeDasharray="3 4" />
          </g>
        ))}
        {shown.map((e, i) => {
          const y = 56 + i * STEP * 2;
          const { path } = splitUrl(e.request.url);
          const preflightAsk = e.kind === 'preflight' ? findHeader(e.request.headers, 'Access-Control-Request-Method') : undefined;
          const label = e.kind === 'preflight' ? `OPTIONS ${path} (preflight${preflightAsk ? `: можно ${preflightAsk}?` : ''})` : `${e.request.method} ${path}`;
          const blocked = !e.response;
          return (
            <g key={e.id}>
              <line x1={LEFT} x2={RIGHT} y1={y} y2={y} stroke="var(--nav)" strokeWidth={1.5} markerEnd="url(#arrow)" />
              <text x={(LEFT + RIGHT) / 2} y={y - 7} textAnchor="middle" fill="var(--nav)">
                {label.length > 52 ? `${label.slice(0, 51)}…` : label}
              </text>
              {blocked ? (
                <>
                  <text x={LEFT + 12} y={y + STEP - 8} fill="var(--err)">
                    ✗ ответа нет
                  </text>
                  <text x={LEFT + 12} y={y + STEP + 8} fill="var(--faint)" className="text-[11px]">
                    {(e.error ?? '').slice(0, 58)}
                  </text>
                </>
              ) : (
                <>
                  <line x1={RIGHT} x2={LEFT} y1={y + STEP} y2={y + STEP} stroke="var(--ok)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#arrow)" />
                  <text x={(LEFT + RIGHT) / 2} y={y + STEP - 7} textAnchor="middle" fill={e.response!.status < 400 ? 'var(--ok)' : 'var(--amber)'}>
                    {e.response!.status} {statusText(e.response!.status)}
                    {findHeader(e.response!.headers, 'Content-Type') ? ` · ${findHeader(e.response!.headers, 'Content-Type')!.split(';')[0]}` : ''}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
