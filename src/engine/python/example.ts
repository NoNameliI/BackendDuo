import { parseRequest, type ApiRequest } from '@/engine/api/http';

/**
 * A `python example` block: main.py, then requests to it, each after a line `###`. A request after `### 500`
 * is meant to crash the handler (the example shows a 500); any other crash is a mistake in the example.
 */
export function splitPythonExample(text: string): { source: string; requests: ApiRequest[]; crashes: boolean[] } {
  const parts = text.replace(/\r\n?/g, '\n').split(/^(###.*)$/m);
  const requests: ApiRequest[] = [];
  const crashes: boolean[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1]?.trim();
    if (!body) continue;
    requests.push(parseRequest(body));
    crashes.push(/^###\s*500\b/.test(parts[i]));
  }
  return { source: parts[0].trimEnd(), requests, crashes };
}
