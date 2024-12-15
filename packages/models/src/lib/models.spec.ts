import { ProductSchema } from './models';

describe('models', () => {
  it('should work', () => {
    expect(
      ProductSchema.parse({ id: '1', name: 'Product 1', price: 100 })
    ).toEqual({ id: '1', name: 'Product 1', price: 100 });
  });
});
