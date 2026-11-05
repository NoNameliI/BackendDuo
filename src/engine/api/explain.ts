/**
 * Plain-Russian explanation of a 422 answer (FastAPI / Pydantic error list), so a beginner sees
 * «не передано обязательное поле quantity в теле запроса» instead of {"type": "missing", …}.
 */
interface Issue {
  type?: string;
  loc?: (string | number)[];
  msg?: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

const PLACE: Record<string, string> = { body: 'в теле запроса', query: 'в параметрах адреса', path: 'в пути', header: 'в заголовках', cookie: 'в cookie' };

function where(loc: (string | number)[] = []): { field: string; place: string } {
  const [first, ...rest] = loc;
  const place = PLACE[String(first)] ?? '';
  const field = rest.length ? rest.join('.') : String(first ?? '');
  return { field: place ? field : loc.join('.'), place };
}

const value = (v: unknown) => (typeof v === 'string' ? `«${v}»` : JSON.stringify(v));

function explainIssue(issue: Issue): string {
  const { field, place } = where(issue.loc);
  const at = `${field ? `«${field}»` : 'тело'}${place ? ` ${place}` : ''}`;
  const ctx = issue.ctx ?? {};
  switch (issue.type) {
    case 'missing':
      return field ? `Не передано обязательное поле ${at}` : `Не передано тело запроса`;
    case 'int_parsing':
    case 'int_type':
    case 'int_from_float':
      return `Поле ${at} должно быть целым числом, а пришло ${value(issue.input)}`;
    case 'float_parsing':
    case 'float_type':
      return `Поле ${at} должно быть числом, а пришло ${value(issue.input)}`;
    case 'bool_parsing':
    case 'bool_type':
      return `Поле ${at} должно быть true или false, а пришло ${value(issue.input)}`;
    case 'string_type':
      return `Поле ${at} должно быть строкой (в кавычках), а пришло ${value(issue.input)}`;
    case 'string_too_short':
      return `Поле ${at} слишком короткое: нужно не меньше ${ctx.min_length} символов`;
    case 'string_too_long':
      return `Поле ${at} слишком длинное: нужно не больше ${ctx.max_length} символов`;
    case 'greater_than_equal':
      return `Поле ${at} должно быть не меньше ${ctx.ge}, а пришло ${value(issue.input)}`;
    case 'greater_than':
      return `Поле ${at} должно быть больше ${ctx.gt}, а пришло ${value(issue.input)}`;
    case 'less_than_equal':
      return `Поле ${at} должно быть не больше ${ctx.le}, а пришло ${value(issue.input)}`;
    case 'less_than':
      return `Поле ${at} должно быть меньше ${ctx.lt}, а пришло ${value(issue.input)}`;
    case 'literal_error':
    case 'enum':
      return `Поле ${at} может быть только ${String(ctx.expected ?? '').replace(' or ', ' или ')}, а пришло ${value(issue.input)}`;
    case 'json_invalid':
      return `Тело запроса — некорректный JSON${ctx.error ? ` (${ctx.error})` : ''}: проверьте двойные кавычки и запятые`;
    case 'model_attributes_type':
    case 'dict_type':
      return 'Тело должно быть объектом JSON в фигурных скобках, а заголовок Content-Type — application/json';
    case 'list_type':
      return `Поле ${at} должно быть списком в квадратных скобках`;
    case 'extra_forbidden':
      return `Лишнее поле ${at}: сервер его не принимает`;
    case 'value_error':
      return `Поле ${at}: ${issue.msg?.replace(/^Value error, /, '') ?? 'значение не подходит'}`;
    default:
      return `${at}: ${issue.msg ?? 'значение не подходит'}`;
  }
}

/** Lines explaining a 422 body, or null when the body is not FastAPI's error list. */
export function explain422(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (!Array.isArray(parsed.detail)) return null;
    return (parsed.detail as Issue[]).map(explainIssue);
  } catch {
    return null;
  }
}
