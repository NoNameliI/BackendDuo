import { useState } from 'react';
import { parseRequest, splitUrl } from '@/engine/api/http';
import type { CorsConfig } from '@/engine/api/server';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { useApiSandbox, type FrontendCall } from './apiStore';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const input = 'rounded border border-line bg-well px-2 py-1 font-mono text-[12.5px] text-fg outline-none focus:border-nav';

/** The page's fetch call as JavaScript, for reading. */
export function fetchCode(call: FrontendCall, baseUrl: string): string {
  const req = parseRequest(call.request);
  const url = splitUrl(req.url).origin ? req.url : `${baseUrl}${req.url}`;
  const options: string[] = [];
  if (req.method !== 'GET') options.push(`  method: '${req.method}',`);
  if (req.headers.length) options.push(`  headers: { ${req.headers.map((h) => `'${h.name}': '${h.value}'`).join(', ')} },`);
  if (req.body) options.push(`  body: JSON.stringify(${req.body}),`);
  if (call.credentials) options.push("  credentials: 'include',");
  return options.length ? `await fetch('${url}', {\n${options.join('\n')}\n});` : `await fetch('${url}');`;
}

const py = (v: string[]) => `[${v.map((s) => `"${s}"`).join(', ')}]`;

export function middlewareCode(cfg: CorsConfig): string {
  return [
    'app.add_middleware(',
    '    CORSMiddleware,',
    `    allow_origins=${py(cfg.allowOrigins)},`,
    `    allow_methods=${py(cfg.allowMethods)},`,
    `    allow_headers=${py(cfg.allowHeaders)},`,
    `    allow_credentials=${cfg.allowCredentials ? 'True' : 'False'},`,
    ')',
  ].join('\n');
}

/** A comma-separated list input that keeps what is being typed. */
function ListInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <label className="block text-[12.5px] text-dim">
      {label}
      <input
        className={`${input} mt-1 w-full`}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
        }}
      />
    </label>
  );
}

/** CORS tasks: the frontend page, the server's CORSMiddleware settings, a button to run the page. */
export function CorsPanel() {
  const useStore = useApiSandbox();
  const cors = useStore((s) => s.cors);
  const baseUrl = useStore((s) => s.baseUrl);
  const setCorsConfig = useStore((s) => s.setCorsConfig);
  const runFrontend = useStore((s) => s.runFrontend);
  if (!cors) return null;
  const { config, call } = cors;
  const update = (patch: Partial<CorsConfig>) => setCorsConfig({ ...config, ...patch });
  const methods = new Set(config.allowMethods.map((m) => m.toUpperCase()));

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-3 @3xl:grid-cols-2">
      <section aria-label="Фронтенд" className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Фронтенд · {call.origin}</h3>
        <pre className="md-code whitespace-pre-wrap text-[12.5px]">{fetchCode(call, baseUrl)}</pre>
        <Button variant="run" icon={<PlayIcon />} onClick={runFrontend}>
          Запустить фронтенд
        </Button>
        <p className="text-[12px] text-faint">Браузер сам добавит заголовок Origin и, если нужно, отправит preflight-запрос OPTIONS.</p>
      </section>
      <section aria-label="Настройки CORS на сервере" className="space-y-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Бэкенд · CORSMiddleware</h3>
        <ListInput key={`o-${config.allowOrigins.join()}`} label="allow_origins — разрешённые origin" placeholder="https://shop.local" value={config.allowOrigins} onChange={(allowOrigins) => update({ allowOrigins })} />
        <fieldset className="text-[12.5px] text-dim">
          <legend>allow_methods — разрешённые методы</legend>
          <div className="mt-1 flex flex-wrap gap-3 font-mono">
            {[...METHODS, '*'].map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={methods.has(m)}
                  onChange={(e) => update({ allowMethods: e.target.checked ? [...config.allowMethods, m] : config.allowMethods.filter((x) => x.toUpperCase() !== m) })}
                />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
        <ListInput key={`h-${config.allowHeaders.join()}`} label="allow_headers — разрешённые заголовки" placeholder="Content-Type, Authorization" value={config.allowHeaders} onChange={(allowHeaders) => update({ allowHeaders })} />
        <label className="flex items-center gap-2 text-[12.5px] text-dim">
          <input type="checkbox" checked={Boolean(config.allowCredentials)} onChange={(e) => update({ allowCredentials: e.target.checked })} />
          allow_credentials — разрешить запросы с cookie
        </label>
        <pre aria-label="Код настройки на FastAPI" className="md-code whitespace-pre-wrap text-[12px]">{middlewareCode(config)}</pre>
      </section>
    </div>
  );
}
