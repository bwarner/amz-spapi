/**
 * Purchase orders the seller ISSUES, and the vendors they are issued to.
 *
 * Everything else in the purchase pipeline is a document someone else wrote —
 * invoices read, waybills filed, receipts reconciled. A purchase order is the
 * one document that originates here: the seller states what they are ordering,
 * a PDF is rendered from that statement, and the statement itself is kept as
 * the source of truth. The rendered file is a projection and can always be
 * re-rendered; the structured order cannot be recovered from a PDF.
 *
 * A PO deliberately bills nothing. Under `PURCHASE_AUTHORITY` the commercial
 * invoice stays the authority on cost — the PO's value in reconciliation is
 * the other side of that comparison: what was *ordered*, so an invoice that
 * quietly differs from it has something to differ from.
 */

import { z } from 'zod';

/** Where a vendor relationship lives, which decides how to contact them. */
export const VendorPlatformSchema = z.enum([
  'alibaba',
  '1688',
  'direct',
  'other',
]);
export type VendorPlatform = z.infer<typeof VendorPlatformSchema>;

/**
 * A vendor the seller buys from — the durable record behind sourcing
 * searches and purchase orders.
 *
 * Identity is the slugged name (`vendorId`), because that is the only
 * identifier every path has: a sourcing search result, a name typed in chat,
 * and a vendor string on an invoice all carry a name and nothing else. Slug
 * matching also makes re-saving the same vendor an update, not a duplicate.
 */
export const VendorSchema = z.object({
  /** Slug of `name` — see `vendorIdForName`. */
  vendorId: z.string().min(1),
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  /** WeChat/WhatsApp handles — how Alibaba/1688 vendors actually talk. */
  wechat: z.string().optional(),
  whatsapp: z.string().optional(),
  addressLines: z.array(z.string()).optional(),
  country: z.string().optional(),
  platform: VendorPlatformSchema.optional(),
  /** Storefront or profile page, e.g. an Alibaba vendor profile. */
  profileUrl: z.string().optional(),
  leadTimeDays: z.number().int().positive().optional(),
  /** Default terms, used to prefill POs: "30% deposit, 70% before shipment". */
  paymentTerms: z.string().optional(),
  incoterms: z.string().optional(),
  notes: z.string().optional(),
});
export type Vendor = z.infer<typeof VendorSchema>;

/**
 * One name, one id, on every path. Lowercased, non-alphanumerics collapsed to
 * single dashes — "Shenzhen  Ku-Xiu Tech." and "shenzhen ku xiu tech" are the
 * same vendor.
 */
export function vendorIdForName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The seller's business identity as printed on POs. Stored once as a profile
 * and applied to every order, because it changes when the business changes,
 * not when the order does.
 */
export const BuyerSchema = z.object({
  name: z.string().min(1),
  addressLines: z.array(z.string()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  /**
   * Dun & Bradstreet number — nine digits. Larger vendors and compliance
   * departments ask for it; printed on the PO when present.
   */
  duns: z
    .string()
    .regex(/^\d{9}$/, 'A DUNS number is nine digits')
    .optional(),
});
export type Buyer = z.infer<typeof BuyerSchema>;

/**
 * A known Amazon fulfillment center address, learned from the seller's own
 * shipment plans. Amazon publishes no FC-address API and third-party lists go
 * stale, so the only trustworthy source is the address the seller's plan
 * actually shows — captured once per FC, reused on every later order.
 */
export const FcAddressSchema = z.object({
  /** The FC code as Amazon prints it: "ONT8", "TEB9". Stored uppercase. */
  fcCode: z.string().regex(/^[A-Z0-9]{3,8}$/),
  addressLines: z.array(z.string()).min(1),
});
export type FcAddress = z.infer<typeof FcAddressSchema>;

export const PurchaseOrderLineSchema = z.object({
  /** The seller's own SKU, when the goods map to one. */
  sku: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  /** "pcs", "sets", "cartons" — printed next to the quantity. */
  unit: z.string().optional(),
  /** Per-unit price in the PO's currency. */
  unitPrice: z.number().nonnegative(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PurchaseOrderSchema = z.object({
  /** Assigned by the store, sequential per seller: "PO-2026-0007". */
  poNumber: z.string().min(1),
  /** YYYY-MM-DD. */
  issueDate: z.string().regex(ISO_DATE),
  /**
   * Vendors counter and mistakes surface after issue. A correction keeps the
   * NUMBER — that is what both sides quote — and increments the revision, so
   * "PO-2026-0007 Rev 2" and the original are recognisably the same order and
   * recognisably different documents.
   */
  revision: z.number().int().positive().default(1),
  /** YYYY-MM-DD of the latest revision; absent on revision 1. */
  revisedDate: z.string().regex(ISO_DATE).optional(),
  /** Why the latest revision exists — printed on the document. */
  revisionNote: z.string().optional(),
  /**
   * A dead order stays on the record as cancelled; deleting it would orphan
   * the number, and numbers with gaps read as missing or forged orders.
   */
  status: z.enum(['open', 'cancelled']).default('open'),
  cancellationReason: z.string().optional(),
  vendorId: z.string().min(1),
  /** ISO 4217, uppercase — every amount on the PO is in this currency. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(PurchaseOrderLineSchema).min(1),
  /** Freight the vendor quotes on the same order, when known. */
  freightAmount: z.number().nonnegative().optional(),
  otherFees: z
    .array(
      z.object({
        description: z.string().min(1),
        amount: z.number().nonnegative(),
      })
    )
    .optional(),
  incoterms: z.string().optional(),
  paymentTerms: z.string().optional(),
  expectedShipDate: z.string().regex(ISO_DATE).optional(),
  /** Who is ordering — filled from the stored buyer profile when absent. */
  buyer: BuyerSchema.optional(),
  /** Where the goods go — a 3PL, a prep center, or an Amazon FC. */
  shipTo: z
    .object({
      name: z.string().min(1),
      addressLines: z.array(z.string()).min(1),
    })
    .optional(),
  notes: z.string().optional(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export type PurchaseOrderTotals = {
  /** Sum of quantity × unitPrice over the lines. */
  goodsSubtotal: number;
  freight: number;
  fees: number;
  total: number;
  totalUnits: number;
};

/** Round to cents once per figure, so printed lines sum to the printed total. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Totals are always derived, never stored — a stored total can disagree with
 * the lines it claims to summarise, and then the PDF prints the disagreement.
 */
export function purchaseOrderTotals(
  order: Pick<PurchaseOrder, 'lines' | 'freightAmount' | 'otherFees'>
): PurchaseOrderTotals {
  const goodsCents = order.lines.reduce(
    (sum, line) => sum + toCents(line.quantity * line.unitPrice),
    0
  );
  const freightCents = toCents(order.freightAmount ?? 0);
  const feesCents = (order.otherFees ?? []).reduce(
    (sum, fee) => sum + toCents(fee.amount),
    0
  );
  return {
    goodsSubtotal: goodsCents / 100,
    freight: freightCents / 100,
    fees: feesCents / 100,
    total: (goodsCents + freightCents + feesCents) / 100,
    totalUnits: order.lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/** "PO-2026-0007" — zero-padded so lexical order is chronological order. */
export function formatPoNumber(year: number, sequence: number): string {
  return `PO-${year}-${String(sequence).padStart(4, '0')}`;
}
