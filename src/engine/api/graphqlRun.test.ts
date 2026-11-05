import { describe, expect, it } from 'vitest';
import { explainGraphqlError, GraphqlServer, selectedFields } from './graphqlRun';

const SDL = `
type Category { id: ID! title: String! products: [Product!]! }
type Product { id: ID! name: String! price: Int! category: Category }
type Customer { id: ID! name: String! orders: [Order!]! }
type Order { id: ID! status: String! customer: Customer! product: Product! }
input OrderInput { customer_id: ID! product_id: ID! status: String! }
type Query {
  products(category_id: ID, limit: Int): [Product!]!
  product(id: ID!): Product
  customers: [Customer!]!
}
type Mutation {
  createOrder(input: OrderInput!): Order!
  updateOrder(id: ID!, status: String!): Order!
  deleteOrder(id: ID!): Boolean!
}`;

const DATA = {
  categories: [{ id: 1, title: 'Напитки' }, { id: 2, title: 'Сладости' }],
  products: [
    { id: 1, name: 'Чай', price: 300, category_id: 1 },
    { id: 2, name: 'Кофе', price: 450, category_id: 1 },
    { id: 3, name: 'Печенье', price: 120, category_id: 2 },
  ],
  customers: [{ id: 1, name: 'Анна' }, { id: 2, name: 'Борис' }],
  orders: [
    { id: 1, status: 'new', customer_id: 1, product_id: 2 },
    { id: 2, status: 'paid', customer_id: 1, product_id: 3 },
  ],
};

describe('GraphqlServer', () => {
  it('resolves lists, filters, single items and relations by convention', () => {
    const s = new GraphqlServer(SDL, DATA);
    expect(s.run('{ products(category_id: 1) { name category { title } } }')).toMatchObject({
      data: { products: [{ name: 'Чай', category: { title: 'Напитки' } }, { name: 'Кофе', category: { title: 'Напитки' } }] },
    });
    expect((s.run('{ product(id: 3) { name price } }')).data).toEqual({ product: { name: 'Печенье', price: 120 } });
    const nested = s.run('{ customers { name orders { status product { name } } } }');
    expect(nested.data).toEqual({
      customers: [
        { name: 'Анна', orders: [{ status: 'new', product: { name: 'Кофе' } }, { status: 'paid', product: { name: 'Печенье' } }] },
        { name: 'Борис', orders: [] },
      ],
    });
    // 1 lookup for customers + 1 per customer for orders + 1 per order for its product: the N+1 pattern.
    expect(nested.calls).toBe(1 + 2 + 2);
  });

  it('runs mutations', () => {
    const s = new GraphqlServer(SDL, DATA);
    const created = s.run('mutation { createOrder(input: { customer_id: 2, product_id: 1, status: "new" }) { id status customer { name } } }');
    expect(created.data).toEqual({ createOrder: { id: '3', status: 'new', customer: { name: 'Борис' } } });
    expect((s.run('mutation { updateOrder(id: 3, status: "paid") { status } }')).data).toEqual({ updateOrder: { status: 'paid' } });
    expect((s.run('mutation { deleteOrder(id: 3) }')).data).toEqual({ deleteOrder: true });
    expect(s.collections.orders).toHaveLength(2);
  });

  it('reports errors in Russian and lists selected fields', () => {
    const s = new GraphqlServer(SDL, DATA);
    const bad = s.run('{ products { title } }');
    expect(explainGraphqlError(bad.errors![0].message)).toBe('У типа Product нет поля «title». Сверьтесь со схемой (вкладка «Схема»).');
    expect(explainGraphqlError((s.run('{ products { category } }')).errors![0].message)).toMatch(/^Поле «category» — объект/);
    expect(explainGraphqlError((s.run('{ products { name }')).errors![0].message)).toMatch(/^Синтаксическая ошибка/);
    expect(selectedFields('{ list: products { name category { title } } }')).toEqual(['products', 'products.category', 'products.category.title', 'products.name']);
  });
});
