/**
 * Document recognition.
 *
 * Fixtures are shortened from real uploads — an OpenAI receipt, a Panamanian
 * supplier invoice, a DHL proof of delivery and its waybill — with names and
 * addresses removed. The phrasing that drives each match is verbatim.
 */

import { describe, expect, it } from 'vitest';
import { recognizeDocument } from './document-recognize.js';

const RECEIPT =
  'Receipt Invoice number HYFXIBJP-0002 Receipt number 2392-9436-5969 ' +
  'Date paid June 8, 2026 $20.00 amount paid Description Qty Unit price ' +
  'Amount Credits 500 $0.04 $20.00 Subtotal Total Payment history Payment method';

const INVOICE =
  'Example Coffee S.A. Invoice R.U.C. 155693518-2-2020 FECHA: 06/01/2026 ' +
  'Q Descripción Unitario Total (US $) 100 Geisha washed process 75 gr bags ' +
  '$ 7.00 $ 700.00 Sub total $ 4,102.04 TOTAL US $:';

const POD =
  'This is a proof of delivery / statement of final status for the shipment ' +
  'with waybill number 3583595831. Your shipment was delivered on 22 April ' +
  '2026 at 13.07 Signed Receiver Name Shipment Status Delivered ' +
  'Number of Pieces 1';

const WAYBILL =
  'DHL EXPRESS WAYBILL Air waybill 3583595831 Shipper Name Consignee ' +
  'Number of Pieces 1 Chargeable weight 10.00 kg Declared value for customs 700.00 USD';

/** Verbatim structure of the PO that shipped as "invoice, confidence 1.00". */
const PURCHASE_ORDER =
  'PURCHASE ORDER PO-2026-0001 Issue date: 2026-08-04 Currency: USD ' +
  'FROM (BUYER) Farvision LLC TO (VENDOR) Panama Select SHIP TO FBA: ' +
  'Farvision LLC c/o Amazon.com Services LLC SKU Description Quantity ' +
  'Unit price Amount FB-COF-HGE-250 80 bags USD 20.00 USD 1,600.00 ' +
  'Goods subtotal USD 1,600.00 TOTAL USD 1,600.00 PAYMENT TERMS Net 60';

const recognise = (text: string, fileName = 'doc.pdf') =>
  recognizeDocument({ fileName, mimeType: 'application/pdf', text });

describe('recognizeDocument', () => {
  it('identifies the four paperwork kinds', () => {
    expect(recognise(RECEIPT).kind).toBe('receipt');
    expect(recognise(INVOICE).kind).toBe('commercial-invoice');
    expect(recognise(POD).kind).toBe('proof-of-delivery');
    expect(recognise(WAYBILL).kind).toBe('transport-document');
  });

  it('recognises a purchase order, not the invoice its table resembles', () => {
    // The exact misfile this pins: a PO shares description / unit price /
    // subtotal / total with an invoice, and with no PO matcher those 8 points
    // made it a "commercial-invoice — confidence 1.00". The heading has to win.
    const result = recognise(PURCHASE_ORDER);
    expect(result.kind).toBe('purchase-order');
    expect(result.needsUserChoice).toBe(false);
  });

  it('keeps an invoice that merely cites its PO number as an invoice', () => {
    // Suppliers routinely print the PO they are answering. The citation must
    // not flip the document; at most the PO surfaces as an alternative.
    const result = recognise(
      INVOICE + ' Ref: purchase order PO-1043 as agreed'
    );
    expect(result.kind).toBe('commercial-invoice');
  });

  it('does not file a proof of delivery as the carriage contract', () => {
    // A DHL POD says both "proof of delivery" AND "waybill number". Filing it
    // as a transport document would double-count its weight in freight
    // allocation.
    expect(recognise(POD).kind).toBe('proof-of-delivery');
  });

  it('does not treat a document that MENTIONS a shipment as a box label', () => {
    // A 16-page claim quoting FBA19CBC1Q88 scored as a box label. An id is
    // evidence a document concerns something, not that it is that thing.
    const claim =
      'Inventory Adjustment Request Amazon Case 20441582891 Inbound Shipment ' +
      'FBA19CBC1Q88 prepared 26 July 2026. ' +
      'Forty units were received into inventory under the FNSKU of a different ' +
      'product. '.repeat(20);
    const result = recognise(claim);
    expect(result.kind).not.toBe('fba-box-label');
    expect(result.needsUserChoice).toBe(true);
  });

  it('recognises a real box label', () => {
    const boxLabel =
      'FBA Box 1 of 1 - 20lb SHIP FROM: Sender SHIP TO: FBA: Example LLC LBE1 ' +
      'FBA19G33WPZ3U000001 Single SKU FB-COF-GEI-75 Qty 100 ' +
      'PLEASE LEAVE THIS LABEL UNCOVERED';
    expect(recognise(boxLabel).kind).toBe('fba-box-label');
  });

  it('recognises an FNSKU label but not a document quoting an FNSKU', () => {
    expect(
      recognise('X004GSWNXF New - Example Coffee Floral & Caramel').kind
    ).toBe('fnsku-label');
    const invoiceQuotingFnsku = `${INVOICE} FNSKU X004GSWNXF`;
    expect(recognise(invoiceQuotingFnsku).kind).toBe('commercial-invoice');
  });

  it('never reports full confidence in an unrecognised document', () => {
    // "unknown, confidence 1.00" is a contradiction: the winner's share of the
    // evidence is not the same as the evidence being sufficient.
    // Long prose with no money words: a document we cannot place, not artwork.
    const result = recognise(
      'Quarterly summary of activity and observations. '.repeat(40)
    );
    expect(result.kind).toBe('unknown');
    expect(result.confidence).toBeLessThan(1);
    expect(result.needsUserChoice).toBe(true);
  });

  it('distinguishes "nothing to read" from "read it and could not tell"', () => {
    const scanned = recognizeDocument({
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      text: '',
      noExtractableText: true,
    });
    expect(scanned.kind).toBe('unknown');
    expect(scanned.signals[0].reason).toContain('OCR');
  });

  it('trusts column headers over keywords for Amazon reports', () => {
    const result = recognizeDocument({
      fileName: 'anything.csv',
      text: INVOICE,
      reportKind: 'ledger-detail',
    });
    expect(result.kind).toBe('amazon-report');
    expect(result.needsUserChoice).toBe(false);
  });

  it('ignores the filename entirely', () => {
    // "BF Warner april 2026.pdf" was dated January inside. Filenames get no
    // vote — they are exactly what people put on the wrong file.
    const asInvoice = recognise(RECEIPT, 'definitely-an-invoice.pdf');
    expect(asInvoice.kind).toBe('receipt');
  });

  it('guesses artwork for short text with no paperwork vocabulary', () => {
    const result = recognise(
      'EXAMPLE COFFEE 250g Whole Bean Roasted in Panama'
    );
    expect(result.kind).toBe('design-artwork');
    // A guess, so it must be presented as one.
    expect(result.needsUserChoice).toBe(true);
  });

  it('treats a design file as artwork on its extension', () => {
    expect(recognizeDocument({ fileName: 'carton.ai', text: '' }).kind).toBe(
      'design-artwork'
    );
  });
});
