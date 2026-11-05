import { buildSchema, getNamedType, graphqlSync, isListType, isNonNullType, parse, visit, type GraphQLResolveInfo, type GraphQLSchema } from 'graphql';

/**
 * A GraphQL server over in-memory collections, without hand-written resolvers. Conventions:
 * - Query `products(category: …)` → collection `products` filtered by the arguments (`limit` cuts the list);
 * - Query `product(id: …)` → the item of `products` with that id;
 * - a field missing on the item: `customer` → `customers` by `customer_id`; a list `orders` → `orders` whose
 *   `<parent>_id` points back;
 * - Mutation `create<Type>` / `update<Type>` / `delete<Type>` (arguments or one `input` object).
 * Every collection lookup counts as one call to the data source, which makes N+1 visible.
 */
export type Collections = Record<string, Record<string, unknown>[]>;

export interface GraphqlError {
  message: string;
  path?: readonly (string | number)[];
}

export interface GraphqlResult {
  data?: unknown;
  errors?: GraphqlError[];
  /** Data source lookups made by the query. */
  calls: number;
}

const plural = (word: string) => (word.endsWith('s') ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`);
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const same = (a: unknown, b: unknown) => String(a) === String(b);

interface Ctx {
  calls: number;
}

export class GraphqlServer {
  readonly schema: GraphQLSchema;
  private readonly data: Collections;

  constructor(
    readonly sdl: string,
    collections: Collections,
  ) {
    this.schema = buildSchema(sdl);
    this.data = structuredClone(collections);
  }

  get collections(): Readonly<Collections> {
    return this.data;
  }

  private collection(name: string, ctx: Ctx): Record<string, unknown>[] | undefined {
    const found = this.data[name] ?? this.data[plural(name)] ?? this.data[snake(name)] ?? this.data[plural(snake(name))];
    if (found) ctx.calls++;
    return found;
  }

  private resolve = (source: unknown, args: Record<string, unknown>, ctx: Ctx, info: GraphQLResolveInfo): unknown => {
    const parent = info.parentType.name;
    const field = info.fieldName;
    const returns = info.returnType;
    const listType = isListType(isNonNullType(returns) ? returns.ofType : returns);
    const typeName = getNamedType(returns).name;
    const input = (args.input && typeof args.input === 'object' ? args.input : args) as Record<string, unknown>;

    if (parent === this.schema.getMutationType()?.name) {
      const m = /^(create|add|update|delete|remove)(\w+)$/.exec(field);
      if (!m) throw new Error(`Учебный сервер не знает, как выполнить мутацию ${field}`);
      const items = this.collection(lowerFirst(m[2]), ctx) ?? [];
      if (m[1] === 'create' || m[1] === 'add') {
        const item = { id: Math.max(0, ...items.map((i) => Number(i.id) || 0)) + 1, ...input };
        items.push(item);
        return item;
      }
      const index = items.findIndex((i) => same(i.id, args.id ?? input.id));
      if (index === -1) throw new Error(`${m[2]} с id ${String(args.id ?? input.id)} не найден`);
      if (m[1] === 'update') {
        const patch = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'id'));
        items[index] = { ...items[index], ...patch };
        return items[index];
      }
      const [removed] = items.splice(index, 1);
      return typeName === 'Boolean' ? true : removed;
    }

    if (parent === this.schema.getQueryType()?.name) {
      if (listType) {
        const items = this.collection(field, ctx) ?? this.collection(lowerFirst(typeName), ctx) ?? [];
        const filters = Object.entries(args).filter(([k]) => k !== 'limit' && k !== 'first' && k !== 'offset');
        let list = items.filter((item) => filters.every(([k, v]) => v === undefined || v === null || same(item[k], v)));
        const offset = Number(args.offset ?? 0);
        const limit = args.limit ?? args.first;
        list = list.slice(offset, limit === undefined ? undefined : offset + Number(limit));
        return list;
      }
      const items = this.collection(plural(field), ctx) ?? this.collection(lowerFirst(typeName), ctx) ?? [];
      return items.find((item) => Object.entries(args).every(([k, v]) => same(item[k], v))) ?? null;
    }

    const item = source as Record<string, unknown>;
    if (item && field in item) {
      const value = item[field];
      // A stored id list (e.g. "tag_ids") is not here; plain values and nested objects are returned as is.
      return value;
    }
    if (listType) {
      const items = this.collection(lowerFirst(typeName), ctx) ?? this.collection(field, ctx) ?? [];
      const key = `${snake(lowerFirst(parent))}_id`;
      return items.filter((i) => same(i[key], item?.id));
    }
    const ref = item?.[`${snake(field)}_id`] ?? item?.[`${field}Id`];
    if (ref === undefined) return null;
    const items = this.collection(lowerFirst(typeName), ctx) ?? [];
    return items.find((i) => same(i.id, ref)) ?? null;
  };

  run(query: string, variables?: Record<string, unknown>): GraphqlResult {
    const ctx: Ctx = { calls: 0 };
    const result = graphqlSync({ schema: this.schema, source: query, variableValues: variables, contextValue: ctx, fieldResolver: this.resolve });
    return {
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.errors?.length ? { errors: result.errors.map((e) => ({ message: e.message, ...(e.path ? { path: e.path } : {}) })) } : {}),
      calls: ctx.calls,
    };
  }
}

/** Field paths a query selects (aliases resolved to field names), e.g. `products`, `products.name`. */
export function selectedFields(query: string): string[] {
  const out = new Set<string>();
  const stack: string[] = [];
  visit(parse(query), {
    Field: {
      enter(node) {
        stack.push(node.name.value);
        if (node.name.value !== '__typename') out.add(stack.join('.'));
      },
      leave() {
        stack.pop();
      },
    },
  });
  return [...out].sort();
}

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Cannot query field "(\w+)" on type "(\w+)"/, (m) => `У типа ${m[2]} нет поля «${m[1]}». Сверьтесь со схемой (вкладка «Схема»).`],
  [/^Field "(\w+)" of type "([^"]+)" must have a selection of subfields/, (m) => `Поле «${m[1]}» — объект (${m[2]}): перечислите в фигурных скобках, какие его поля нужны.`],
  [/^Field "(\w+)" must not have a selection since type "([^"]+)" has no subfields/, (m) => `У поля «${m[1]}» (${m[2]}) нет вложенных полей — уберите фигурные скобки после него.`],
  [/^Field "(\w+)" argument "(\w+)" of type "([^"]+)" is required/, (m) => `Полю «${m[1]}» нужен аргумент ${m[2]} (${m[3]}).`],
  [/^Unknown argument "(\w+)" on field "([\w.]+)"/, (m) => `У поля ${m[2]} нет аргумента «${m[1]}».`],
  [/^Syntax Error: Unexpected character: U\+2026/, () => 'В запросе остался пропуск «…» из заготовки: впишите на его место нужное.'],
  [/^Syntax Error: Expected Name, found "}"/, () => 'Синтаксическая ошибка: внутри фигурных скобок пусто. Перечислите нужные поля.'],
  [/^Syntax Error: (.+?)\.?$/, (m) => `Синтаксическая ошибка: ${m[1]}. Проверьте парные фигурные скобки и двоеточия в аргументах.`],
  [/^Variable "\$(\w+)" of required type "([^"]+)" was not provided/, (m) => `Не передана переменная $${m[1]} (${m[2]}).`],
  [/^Cannot query field "(\w+)" on type "Mutation"/, (m) => `Мутации ${m[1]} в схеме нет.`],
];

/** A beginner-friendly Russian version of a graphql-js error message. */
export function explainGraphqlError(message: string): string {
  for (const [re, make] of RULES) {
    const m = re.exec(message);
    if (m) return make(m);
  }
  return message;
}
