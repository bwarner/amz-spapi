import { collectionName, executeQuery } from './couchbase-utils.js';

/**
 * The naming rule from ADR-0005, and the guard that catches statements written
 * against the old layout. Neither needs a cluster.
 */

describe('collectionName', () => {
  it('joins the domain and entity', () => {
    expect(collectionName('a_plus', 'drafts')).toBe('a_plus_drafts');
    expect(collectionName('ops', 'cost_ledger')).toBe('ops_cost_ledger');
  });

  it('keeps apart the two collections that would otherwise collide', () => {
    // `listings` existed under both scopes; flattening without the prefix would
    // have merged the SP-API cache into the product catalogue.
    expect(collectionName('sp_cache', 'listings')).toBe('sp_cache_listings');
    expect(collectionName('catalog', 'listings')).toBe('catalog_listings');
    expect(collectionName('sp_cache', 'listings')).not.toBe(
      collectionName('catalog', 'listings')
    );
  });

  it('produces a name that is not a N1QL reserved word', () => {
    // `rows` is reserved and needed backticking everywhere; the prefix retires
    // that problem rather than documenting it.
    expect(collectionName('reports', 'rows')).toBe('reports_rows');
  });
});

describe('executeQuery guard', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = {
      ...env,
      CB_DATA_API_URL: 'https://example.invalid',
      CB_USERNAME: 'u',
      CB_PASSWORD: 'p',
      CB_BUCKET: 'b',
      CB_SCOPE: 'dev',
    };
  });
  afterEach(() => {
    process.env = env;
  });

  it('refuses a statement that still names a bare collection', async () => {
    // Couchbase would answer "keyspace not found" at runtime, in whichever code
    // path happened to run. This turns it into an error naming the fix.
    await expect(
      executeQuery('a_plus', 'SELECT COUNT(*) FROM `drafts`')
    ).rejects.toThrow(/no longer exists/);
  });

  it('names the replacement in the error', async () => {
    await expect(
      executeQuery('reports', 'SELECT * FROM `imports`')
    ).rejects.toThrow(/reports_imports/);
  });

  it('accepts an already-qualified name', async () => {
    // Reaches the network and fails there, which is the point — it got past the
    // guard. The host is unroutable by construction.
    await expect(
      executeQuery('a_plus', 'SELECT COUNT(*) FROM `a_plus_drafts`')
    ).rejects.not.toThrow(/no longer exists/);
  });

  it('does not mistake a backticked field for a collection', async () => {
    // `deleted` is a document field, and N1QL escapes fields exactly the way it
    // escapes keyspaces. Matching every quoted token made the soft-delete guard
    // on nearly every read look like an unmigrated collection, so /api/products
    // answered 500 while the statement was correct.
    await expect(
      executeQuery(
        'catalog',
        'SELECT RAW p FROM `catalog_products` p WHERE p.`deleted` IS MISSING'
      )
    ).rejects.not.toThrow(/no longer exists/);
  });

  it('does not mistake a bare selected field for a collection', async () => {
    await expect(
      executeQuery('catalog', 'SELECT `title` FROM `catalog_products`')
    ).rejects.not.toThrow(/no longer exists/);
  });

  it('still catches a bare keyspace in a JOIN', async () => {
    await expect(
      executeQuery(
        'catalog',
        'SELECT * FROM `catalog_products` p JOIN `variants` v ON v.productId = p.productId'
      )
    ).rejects.toThrow(/catalog_variants/);
  });

  it('still catches a bare keyspace in UPDATE and DELETE FROM', async () => {
    await expect(
      executeQuery('catalog', 'UPDATE `products` SET x = 1')
    ).rejects.toThrow(/no longer exists/);

    await expect(
      executeQuery('catalog', 'DELETE FROM `products` WHERE x = 1')
    ).rejects.toThrow(/no longer exists/);
  });

  it('still catches a bare keyspace in UPSERT INTO', async () => {
    await expect(
      executeQuery(
        'catalog',
        'UPSERT INTO `products` (KEY, VALUE) VALUES ($k, $v)'
      )
    ).rejects.toThrow(/no longer exists/);
  });
});
