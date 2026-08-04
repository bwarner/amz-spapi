/**
 * Host implementation of the vendor directory and purchase order issuance
 * for the chat agent.
 *
 * The agent passes structured orders; this file owns everything with authority
 * in it — PO numbering (a Couchbase counter, never the model), the issue date,
 * persistence, and rendering. The rendered PDF is persisted as a media asset
 * and served through the existing ownership-checked asset route, so a download
 * link is just an asset URL with a filename.
 */

import type {
  BuyerInput,
  FcAddressInput,
  PurchaseOrderDraftInput,
  PurchaseOrderRevisionInput,
  SellerProcurementOps,
  VendorInput,
  VendorRecord,
} from '@amz-spapi/seller-agent';
import {
  cancelPurchaseOrder,
  getBuyerProfile,
  getFcAddress,
  listFcAddresses,
  getPurchaseOrder,
  getVendor,
  listPurchaseOrders,
  listVendors,
  nextPoNumber,
  recordRenderedPo,
  revisePurchaseOrder,
  saveBuyerProfile,
  saveFcAddress,
  saveVendor,
  storePurchaseOrder,
  type StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';
import {
  purchaseOrderTotals,
  type PurchaseOrder,
  type Vendor,
} from '@farvisionllc/models';
import { getAsset, persistGeneratedFileAsset } from './media-assets';
import { renderPurchaseOrderPdf } from './purchase-order-pdf';
import { renderPurchaseOrderXlsx } from './purchase-order-xlsx';

type PoFormat = 'pdf' | 'xlsx';

const PO_MIME: Record<PoFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function downloadUrlFor(
  assetId: string,
  poNumber: string,
  format: PoFormat
): string {
  return `/api/a-plus/assets/${assetId}?download=1&filename=${poNumber}.${format}`;
}

function toVendorRecord(vendor: Vendor): VendorRecord {
  return vendor;
}

export function createProcurementOps(params: {
  userId: string;
}): SellerProcurementOps {
  const { userId } = params;

  async function requireOrder(poNumber: string): Promise<StoredPurchaseOrder> {
    const stored = await getPurchaseOrder(userId, poNumber);
    if (!stored) {
      throw new Error(
        `No purchase order ${poNumber}. Use list-purchase-orders to see what exists.`
      );
    }
    return stored;
  }

  async function requireVendor(vendorId: string): Promise<Vendor> {
    const stored = await getVendor(userId, vendorId);
    if (!stored) {
      throw new Error(
        `No saved vendor "${vendorId}". Use list-vendors, or save-vendor first.`
      );
    }
    return stored.vendor;
  }

  return {
    async saveVendor(vendor: VendorInput) {
      const saved = await saveVendor({ userId, vendor });
      return toVendorRecord(saved.vendor);
    },

    async listVendors() {
      const records = await listVendors({ userId });
      return records.map((record) => toVendorRecord(record.vendor));
    },

    async setBuyerProfile(buyer: BuyerInput) {
      const saved = await saveBuyerProfile({ userId, buyer });
      return saved.buyer;
    },

    async getBuyerProfile() {
      const stored = await getBuyerProfile(userId);
      return stored?.buyer ?? null;
    },

    async saveFcAddress(fc: FcAddressInput) {
      const saved = await saveFcAddress({ userId, fc });
      return saved.fc;
    },

    async getFcAddress({ fcCode }: { fcCode: string }) {
      const stored = await getFcAddress(userId, fcCode);
      return stored?.fc ?? null;
    },

    async listFcAddresses() {
      const records = await listFcAddresses({ userId });
      return records.map((record) => record.fc);
    },

    async createPurchaseOrder(draft: PurchaseOrderDraftInput) {
      // The vendor arrives inline and is upserted as a side effect: a known
      // name (by slug) is enriched, an unknown one is created by its first
      // order. The saved record, not the inline snippet, is what renders.
      const { vendor: vendorInput, ...content } = draft;
      const saved = await saveVendor({ userId, vendor: vendorInput });
      const vendor = saved.vendor;

      // Buyer identity: an inline buyer updates the stored profile (same
      // side-effect contract as the vendor); absent, the profile fills in.
      if (content.buyer) {
        content.buyer = (
          await saveBuyerProfile({ userId, buyer: content.buyer })
        ).buyer;
      } else {
        content.buyer = (await getBuyerProfile(userId))?.buyer;
      }

      // The system, not the model, decides identity and date: numbers come
      // from the per-seller counter and the date is the day of approval.
      const issueDate = new Date().toISOString().slice(0, 10);
      const year = Number(issueDate.slice(0, 4));
      const poNumber = await nextPoNumber(userId, year);

      const order: PurchaseOrder = {
        poNumber,
        issueDate,
        revision: 1,
        status: 'open',
        vendorId: vendor.vendorId,
        ...content,
      };
      await storePurchaseOrder({ userId, order });

      return {
        poNumber,
        issueDate,
        vendorName: vendor.name,
        totals: purchaseOrderTotals(order),
      };
    },

    async revisePurchaseOrder(input: PurchaseOrderRevisionInput) {
      const { poNumber, revisionNote, ...changes } = input;
      const revised = await revisePurchaseOrder({
        userId,
        poNumber,
        changes,
        revisionNote,
        revisedDate: new Date().toISOString().slice(0, 10),
      });
      const vendor = await requireVendor(revised.order.vendorId);
      return {
        poNumber,
        revision: revised.order.revision,
        vendorName: vendor.name,
        totals: purchaseOrderTotals(revised.order),
      };
    },

    async cancelPurchaseOrder({ poNumber, reason }) {
      const cancelled = await cancelPurchaseOrder({ userId, poNumber, reason });
      return { poNumber, status: cancelled.order.status };
    },

    async renderPurchaseOrder({ poNumber, format }) {
      const stored = await requireOrder(poNumber);
      if (stored.order.status === 'cancelled') {
        throw new Error(
          `${poNumber} is cancelled — there is nothing to issue. Its replacement, if any, is a new order.`
        );
      }

      // An unchanged order keeps its render (storePurchaseOrder drops them on
      // content change), so re-requesting the file never re-renders.
      const existing = stored.renders.find((r) => r.format === format);
      if (existing) {
        const asset = await getAsset(existing.assetId);
        return {
          downloadUrl: downloadUrlFor(existing.assetId, poNumber, format),
          fileName: `${poNumber}.${format}`,
          sizeBytes: asset?.sizeBytes ?? 0,
        };
      }

      const vendor = await requireVendor(stored.order.vendorId);
      const bytes =
        format === 'pdf'
          ? await renderPurchaseOrderPdf({ order: stored.order, vendor })
          : await renderPurchaseOrderXlsx({ order: stored.order, vendor });
      const asset = await persistGeneratedFileAsset({
        userId,
        bytes,
        mimeType: PO_MIME[format],
        extension: format,
        feature: 'documents',
      });
      await recordRenderedPo({
        userId,
        poNumber,
        render: { format, assetId: asset.assetId, renderedAt: Date.now() },
      });

      return {
        downloadUrl: downloadUrlFor(asset.assetId, poNumber, format),
        fileName: `${poNumber}.${format}`,
        sizeBytes: asset.sizeBytes,
      };
    },

    async listPurchaseOrders(filters) {
      const [orders, vendors] = await Promise.all([
        listPurchaseOrders({ userId, ...filters }),
        listVendors({ userId }),
      ]);
      const names = new Map(
        vendors.map((s) => [s.vendor.vendorId, s.vendor.name])
      );
      return orders.map((stored) => ({
        poNumber: stored.order.poNumber,
        issueDate: stored.order.issueDate,
        vendorId: stored.order.vendorId,
        vendorName: names.get(stored.order.vendorId),
        currency: stored.order.currency,
        total: purchaseOrderTotals(stored.order).total,
        revision: stored.order.revision,
        status: stored.order.status,
        rendered: stored.renders.length > 0,
      }));
    },

    async getPurchaseOrder({ poNumber }) {
      const stored = await getPurchaseOrder(userId, poNumber);
      if (!stored) return null;

      const vendor = await getVendor(userId, stored.order.vendorId);
      const downloads = stored.renders.map((render) => ({
        format: render.format,
        downloadUrl: downloadUrlFor(render.assetId, poNumber, render.format),
      }));
      return {
        order: stored.order as unknown as Record<string, unknown>,
        vendorName: vendor?.vendor.name,
        totals: purchaseOrderTotals(stored.order),
        downloads: downloads.length ? downloads : undefined,
      };
    },
  };
}
