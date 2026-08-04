import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVendor,
  listVendors,
  saveVendor,
  vendorStorage,
  type StoredVendor,
} from './vendor-store.js';

/**
 * The judgement here is identity and merging: the same name in any spelling is
 * one vendor, and a sparse re-save must not blank out details a human typed.
 * The Couchbase calls are a seam, so none of this needs a cluster.
 */

const stored = new Map<string, StoredVendor>();

beforeEach(() => {
  stored.clear();
  vi.spyOn(vendorStorage, 'upsertDocument').mockImplementation(
    async (_scope, _collection, key, value) => {
      stored.set(key as string, value as StoredVendor);
      return true as never;
    }
  );
  vi.spyOn(vendorStorage, 'getDocument').mockImplementation(
    async (_scope, _collection, key) =>
      (stored.get(key as string) ?? null) as never
  );
  vi.spyOn(vendorStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [...stored.values()] } as never)
  );
});

describe('saveVendor', () => {
  it('derives identity from the slugged name', async () => {
    const record = await saveVendor({
      userId: 'auth0|seller',
      vendor: { name: 'Shenzhen  Ku-Xiu Tech.' },
    });
    expect(record.vendor.vendorId).toBe('shenzhen-ku-xiu-tech');
    expect(record.key).toBe('auth0|seller::shenzhen-ku-xiu-tech');
  });

  it('updates rather than duplicates when the name re-slugs the same', async () => {
    await saveVendor({
      userId: 'auth0|seller',
      vendor: { name: 'Shenzhen Ku-Xiu Tech', email: 'sales@kuxiu.example' },
    });
    await saveVendor({
      userId: 'auth0|seller',
      vendor: { name: 'shenzhen ku xiu tech!', country: 'CN' },
    });
    expect(stored.size).toBe(1);
  });

  it('merges: absent fields keep their stored value', async () => {
    await saveVendor({
      userId: 'auth0|seller',
      vendor: {
        name: 'Ku-Xiu',
        email: 'sales@kuxiu.example',
        paymentTerms: '30% deposit, 70% before shipment',
      },
    });
    const updated = await saveVendor({
      userId: 'auth0|seller',
      vendor: { name: 'Ku-Xiu', country: 'CN' },
    });
    expect(updated.vendor.email).toBe('sales@kuxiu.example');
    expect(updated.vendor.paymentTerms).toBe(
      '30% deposit, 70% before shipment'
    );
    expect(updated.vendor.country).toBe('CN');
  });

  it('rejects a name with no usable characters', async () => {
    await expect(
      saveVendor({ userId: 'auth0|seller', vendor: { name: '!!!' } })
    ).rejects.toThrow(/no usable characters/);
  });
});

describe('getVendor', () => {
  it('refuses another seller’s vendor even with the right id', async () => {
    await saveVendor({
      userId: 'auth0|seller',
      vendor: { name: 'Ku-Xiu' },
    });
    // Simulate a key collision read by another user: getDocument is keyed by
    // `${userId}::${vendorId}`, so a different user simply misses.
    expect(await getVendor('auth0|other', 'ku-xiu')).toBeNull();
    expect(await getVendor('auth0|seller', 'ku-xiu')).not.toBeNull();
  });
});

describe('listVendors', () => {
  it('requires a user', async () => {
    await expect(listVendors({ userId: '' })).rejects.toThrow(/needs a user/);
  });
});
