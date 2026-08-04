import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder } from '@farvisionllc/models';
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  nextPoNumber,
  poStorage,
  recordRenderedPo,
  revisePurchaseOrder,
  storePurchaseOrder,
  type StoredPurchaseOrder,
} from './po-store.js';

/**
 * The judgement here: numbers are claimed from the counter and never reused,
 * and a content change invalidates every stored render so a download can never
 * serve a PDF that disagrees with the order. Couchbase is a seam.
 */

const stored = new Map<string, StoredPurchaseOrder>();
let counter = 0;

function order(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    poNumber: 'PO-2026-0001',
    issueDate: '2026-08-03',
    vendorId: 'shenzhen-ku-xiu-tech',
    currency: 'USD',
    lines: [{ description: 'Widget', quantity: 100, unitPrice: 2.5 }],
    revision: 1,
    status: 'open',
    ...overrides,
  };
}

beforeEach(() => {
  stored.clear();
  counter = 0;
  vi.spyOn(poStorage, 'upsertDocument').mockImplementation(
    async (_scope, _collection, key, value) => {
      stored.set(key as string, value as StoredPurchaseOrder);
      return true as never;
    }
  );
  vi.spyOn(poStorage, 'getDocument').mockImplementation(
    async (_scope, _collection, key) =>
      (stored.get(key as string) ?? null) as never
  );
  vi.spyOn(poStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [...stored.values()] } as never)
  );
  vi.spyOn(poStorage, 'incrementCounter').mockImplementation(
    async () => ++counter
  );
});

describe('nextPoNumber', () => {
  it('claims sequential numbers from the counter', async () => {
    expect(await nextPoNumber('auth0|seller', 2026)).toBe('PO-2026-0001');
    expect(await nextPoNumber('auth0|seller', 2026)).toBe('PO-2026-0002');
  });
});

describe('storePurchaseOrder', () => {
  it('validates on the way in', async () => {
    await expect(
      storePurchaseOrder({
        userId: 'auth0|seller',
        order: order({ lines: [] }),
      })
    ).rejects.toThrow();
  });

  it('keeps renders when re-storing identical content', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
    });
    const again = await storePurchaseOrder({
      userId: 'auth0|seller',
      order: order(),
    });
    expect(again.renders).toHaveLength(1);
  });

  it('drops renders when the content changed', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
    });
    const changed = await storePurchaseOrder({
      userId: 'auth0|seller',
      order: order({
        lines: [{ description: 'Widget', quantity: 200, unitPrice: 2.5 }],
      }),
    });
    expect(changed.renders).toHaveLength(0);
  });
});

describe('recordRenderedPo', () => {
  it('replaces the previous render of the same format', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
    });
    const updated = await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-2', renderedAt: 2 },
    });
    expect(updated.renders).toEqual([
      { format: 'pdf', assetId: 'asset-2', renderedAt: 2 },
    ]);
  });

  it('refuses a render for an order that does not exist', async () => {
    await expect(
      recordRenderedPo({
        userId: 'auth0|seller',
        poNumber: 'PO-2026-9999',
        render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
      })
    ).rejects.toThrow(/No purchase order/);
  });
});

describe('revisePurchaseOrder', () => {
  const changes = {
    currency: 'USD',
    lines: [{ description: 'Widget', quantity: 992, unitPrice: 2.5 }],
  };

  it('keeps the number, increments the revision, drops renders', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
    });
    const revised = await revisePurchaseOrder({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      changes,
      revisionNote: 'Quantity to a multiple of 16 per vendor carton size',
      revisedDate: '2026-08-05',
    });
    expect(revised.order.poNumber).toBe('PO-2026-0001');
    expect(revised.order.revision).toBe(2);
    expect(revised.order.issueDate).toBe('2026-08-03');
    expect(revised.order.revisedDate).toBe('2026-08-05');
    expect(revised.renders).toHaveLength(0);
  });

  it('cannot change the vendor — that is a new order', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    const revised = await revisePurchaseOrder({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      // A vendorId smuggled into changes must not take effect.
      changes: { ...changes, vendorId: 'someone-else' } as never,
      revisedDate: '2026-08-05',
    });
    expect(revised.order.vendorId).toBe('shenzhen-ku-xiu-tech');
  });

  it('refuses to revise a cancelled order', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await cancelPurchaseOrder({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
    });
    await expect(
      revisePurchaseOrder({
        userId: 'auth0|seller',
        poNumber: 'PO-2026-0001',
        changes,
        revisedDate: '2026-08-05',
      })
    ).rejects.toThrow(/cancelled/);
  });
});

describe('cancelPurchaseOrder', () => {
  it('marks the order cancelled and drops renders', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    await recordRenderedPo({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      render: { format: 'pdf', assetId: 'asset-1', renderedAt: 1 },
    });
    const cancelled = await cancelPurchaseOrder({
      userId: 'auth0|seller',
      poNumber: 'PO-2026-0001',
      reason: 'Vendor cannot meet the ship date',
    });
    expect(cancelled.order.status).toBe('cancelled');
    expect(cancelled.order.cancellationReason).toBe(
      'Vendor cannot meet the ship date'
    );
    expect(cancelled.renders).toHaveLength(0);
  });
});

describe('getPurchaseOrder', () => {
  it('refuses another seller’s order', async () => {
    await storePurchaseOrder({ userId: 'auth0|seller', order: order() });
    expect(await getPurchaseOrder('auth0|other', 'PO-2026-0001')).toBeNull();
    expect(
      await getPurchaseOrder('auth0|seller', 'PO-2026-0001')
    ).not.toBeNull();
  });
});
