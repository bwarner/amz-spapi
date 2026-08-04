/**
 * Render a purchase order to PDF bytes (#brainstorm → @react-pdf/renderer).
 *
 * Server-side only. The structured `PurchaseOrder` is the record; this file is
 * a pure projection of it — no figure may originate here. Totals come from
 * `purchaseOrderTotals` so the printed lines always sum to the printed total.
 */

import * as React from 'react';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import {
  purchaseOrderTotals,
  type PurchaseOrder,
  type Vendor,
} from '@farvisionllc/models';

/**
 * Never let the renderer insert a hyphen of its own.
 *
 * react-pdf hyphenates at a break by ADDING a `-`. On a SKU that already ends
 * a fragment with one, `FB-COF-WASHED-GEISHA-1000-XL` printed as
 * `FB-COF-WASHED--` / `GEISHA-1000-XL` — a character that is not in the SKU.
 * On a purchase order the printed identifier has to be the identifier, so
 * hyphenation is off and break opportunities are marked explicitly instead.
 *
 * Global to @react-pdf/renderer rather than scoped to this document. Fine while
 * the purchase order is the only PDF; a second one needing different behaviour
 * will have to move this into shared setup.
 */
Font.registerHyphenationCallback((word) => [word]);

/**
 * Mark a long identifier as breakable without changing what it says.
 *
 * react-pdf treats a word as one atom and does NOT clip the overflow, so a SKU
 * wider than its column prints straight over the next one — which is what
 * `FB-COF-HGE-250` did. Widening the column fixed that SKU but not the general
 * case: Amazon seller SKUs run past 40 characters and no fixed width is safe
 * against all of them.
 *
 * Two approaches were tried and rejected against a real render, both because
 * they changed what the page said:
 *
 *   - hyphenating at the SKU's own hyphens — the renderer ADDS a `-` at every
 *     break, printing `FB-COF-WASHED--` / `GEISHA-1000-XL`;
 *   - zero-width spaces — react-pdf gives U+200B real width and still will not
 *     break on it, printing `FB- COF- HGE- 250` and overflowing anyway.
 *
 * An explicit newline is the one break the renderer honours literally. It adds
 * no glyph, so the printed identifier is exactly the stored one. Breaks land
 * after a hyphen where possible, since that is where a reader expects them.
 *
 * The column is 22% of the A4 text width (595pt less 80pt of page padding),
 * less its 8pt gutter — about 105pt. Helvetica capitals and digits average
 * near 0.55em, so at 9pt that is roughly 21 characters; 18 leaves room for the
 * wider letters without measuring glyphs at render time.
 */
const SKU_CHARS_PER_LINE = 18;

// Exported for test: the wrap rule is a correctness property of the
// printed document, not a styling detail.
export function breakable(text: string): string {
  // Keep each hyphen with the fragment it terminates, so a break after one
  // reads as a continuation rather than a missing character.
  const segments = text.split(/(?<=-)/);
  const lines: string[] = [];

  for (const segment of segments) {
    const current = lines[lines.length - 1] ?? '';

    if (current && current.length + segment.length <= SKU_CHARS_PER_LINE) {
      lines[lines.length - 1] = current + segment;
      continue;
    }

    // A single run with no hyphen to break at, longer than the column. Split
    // it hard rather than let it overflow into the description.
    if (segment.length > SKU_CHARS_PER_LINE) {
      lines.push(
        ...(segment.match(new RegExp(`.{1,${SKU_CHARS_PER_LINE}}`, 'g')) ?? [
          segment,
        ])
      );
      continue;
    }

    lines.push(segment);
  }

  return lines.join('\n');
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  poMeta: { textAlign: 'right' },
  poNumber: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  metaLine: { marginTop: 2, color: '#444444' },
  parties: { flexDirection: 'row', gap: 24, marginBottom: 20 },
  party: { flex: 1 },
  partyLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#666666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  partyName: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  partyLine: { marginBottom: 1, color: '#333333' },
  table: { marginBottom: 12 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#999999',
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#dddddd',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  // Every left-aligned column needs a right gutter. Without one on the SKU,
  // `FB-COF-HGE-250` ran straight into the description with no visible gap —
  // react-pdf does not clip overflowing text, and a hyphenated SKU is one
  // unbreakable token, so a column too narrow to hold it spills into its
  // neighbour rather than wrapping. Widened as well: 14% fits roughly eight
  // characters at this size, and seller SKUs are routinely longer.
  colSku: { width: '22%', paddingRight: 8 },
  colDescription: { width: '35%', paddingRight: 8 },
  colQty: { width: '13%', textAlign: 'right' },
  colUnitPrice: { width: '15%', textAlign: 'right' },
  colAmount: { width: '15%', textAlign: 'right' },
  totals: { alignSelf: 'flex-end', width: '40%', marginBottom: 20 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  grandTotal: {
    borderTopWidth: 1,
    borderTopColor: '#999999',
    marginTop: 2,
    paddingTop: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  terms: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginBottom: 16 },
  term: { minWidth: '28%' },
  notes: { marginBottom: 24, color: '#333333' },
  signatures: {
    flexDirection: 'row',
    gap: 48,
    marginTop: 24,
  },
  signature: { flex: 1 },
  signatureLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#999999',
    marginTop: 36,
    paddingTop: 4,
    color: '#666666',
    fontSize: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#999999',
    fontSize: 7,
  },
});

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function Party({
  label,
  name,
  lines,
}: {
  label: string;
  name: string;
  lines: Array<string | undefined>;
}) {
  return (
    <View style={styles.party}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={styles.partyName}>{name}</Text>
      {lines
        .filter((line): line is string => Boolean(line))
        .map((line, i) => (
          <Text key={i} style={styles.partyLine}>
            {line}
          </Text>
        ))}
    </View>
  );
}

function PurchaseOrderDocument({
  order,
  vendor,
}: {
  order: PurchaseOrder;
  vendor: Vendor;
}) {
  const totals = purchaseOrderTotals(order);
  const contactLines = [
    vendor.contactName,
    ...(vendor.addressLines ?? []),
    vendor.country,
    vendor.email,
    vendor.phone,
    vendor.wechat ? `WeChat: ${vendor.wechat}` : undefined,
    vendor.whatsapp ? `WhatsApp: ${vendor.whatsapp}` : undefined,
  ];

  return (
    <Document
      title={order.poNumber}
      author={order.buyer?.name ?? 'Sellavant'}
      subject={`Purchase order ${order.poNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>PURCHASE ORDER</Text>
          <View style={styles.poMeta}>
            <Text style={styles.poNumber}>
              {order.poNumber}
              {order.revision > 1 ? ` · Rev ${order.revision}` : ''}
            </Text>
            <Text style={styles.metaLine}>Issue date: {order.issueDate}</Text>
            {order.revisedDate ? (
              <Text style={styles.metaLine}>Revised: {order.revisedDate}</Text>
            ) : null}
            {order.expectedShipDate ? (
              <Text style={styles.metaLine}>
                Expected ship date: {order.expectedShipDate}
              </Text>
            ) : null}
            <Text style={styles.metaLine}>Currency: {order.currency}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          {order.buyer ? (
            <Party
              label="From (Buyer)"
              name={order.buyer.name}
              lines={[
                ...(order.buyer.addressLines ?? []),
                order.buyer.email,
                order.buyer.phone,
                order.buyer.duns ? `DUNS: ${order.buyer.duns}` : undefined,
              ]}
            />
          ) : null}
          <Party label="To (Vendor)" name={vendor.name} lines={contactLines} />
          {order.shipTo ? (
            <Party
              label="Ship To"
              name={order.shipTo.name}
              lines={order.shipTo.addressLines}
            />
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colSku}>SKU</Text>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQty}>Quantity</Text>
            <Text style={styles.colUnitPrice}>Unit price</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {order.lines.map((line, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={styles.colSku}>{breakable(line.sku ?? '')}</Text>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>
                {line.quantity.toLocaleString('en-US')}
                {line.unit ? ` ${line.unit}` : ''}
              </Text>
              <Text style={styles.colUnitPrice}>
                {money(line.unitPrice, order.currency)}
              </Text>
              <Text style={styles.colAmount}>
                {money(
                  Math.round(line.quantity * line.unitPrice * 100) / 100,
                  order.currency
                )}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Goods subtotal</Text>
            <Text>{money(totals.goodsSubtotal, order.currency)}</Text>
          </View>
          {totals.freight > 0 ? (
            <View style={styles.totalRow}>
              <Text>Freight</Text>
              <Text>{money(totals.freight, order.currency)}</Text>
            </View>
          ) : null}
          {(order.otherFees ?? []).map((fee, i) => (
            <View key={i} style={styles.totalRow}>
              <Text>{fee.description}</Text>
              <Text>{money(fee.amount, order.currency)}</Text>
            </View>
          ))}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text>TOTAL</Text>
            <Text>{money(totals.total, order.currency)}</Text>
          </View>
        </View>

        <View style={styles.terms}>
          {order.incoterms ? (
            <View style={styles.term}>
              <Text style={styles.partyLabel}>Incoterms</Text>
              <Text>{order.incoterms}</Text>
            </View>
          ) : null}
          {order.paymentTerms ? (
            <View style={styles.term}>
              <Text style={styles.partyLabel}>Payment terms</Text>
              <Text>{order.paymentTerms}</Text>
            </View>
          ) : null}
          {vendor.leadTimeDays ? (
            <View style={styles.term}>
              <Text style={styles.partyLabel}>Agreed lead time</Text>
              <Text>{vendor.leadTimeDays} days</Text>
            </View>
          ) : null}
        </View>

        {order.revisionNote ? (
          <View style={styles.notes}>
            <Text style={styles.partyLabel}>
              Revision {order.revision} — reason
            </Text>
            <Text>{order.revisionNote}</Text>
          </View>
        ) : null}

        {order.notes ? (
          <View style={styles.notes}>
            <Text style={styles.partyLabel}>Notes</Text>
            <Text>{order.notes}</Text>
          </View>
        ) : null}

        <View style={styles.signatures}>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>
              Buyer — name, signature, date
            </Text>
          </View>
          <View style={styles.signature}>
            <Text style={styles.signatureLine}>
              Vendor — name, signature, date
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {order.poNumber} · {totals.totalUnits.toLocaleString('en-US')} units ·{' '}
          {money(totals.total, order.currency)}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(params: {
  order: PurchaseOrder;
  vendor: Vendor;
}): Promise<Buffer> {
  return renderToBuffer(
    <PurchaseOrderDocument order={params.order} vendor={params.vendor} />
  );
}
