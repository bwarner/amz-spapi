export { SpCache } from './lib/sp-cache.js';
export type { SpCacheConfig } from './lib/sp-cache.js';
export {
  REPORTS,
  REPORT_KINDS,
  reportByType,
  normalizeHeader,
} from './lib/report-registry.js';
export type {
  ReportKind,
  ReportDefinition,
  ReportFieldName,
} from './lib/report-registry.js';
export {
  parseReport,
  decodeReportBuffer,
  detectReportKind,
} from './lib/report-ingest.js';
export type { ReportRow, ParseResult } from './lib/report-ingest.js';
export {
  storeReportRows,
  recordImport,
  getCoverage,
  queryLedgerRows,
  queryReceiptAggregates,
  deleteReportRows,
  deleteReportImports,
  LEDGER_AUTHORITY,
} from './lib/report-store.js';
export type {
  ReportImport,
  ReportSource,
  Coverage,
  LedgerQuery,
  ReceiptAggregate,
} from './lib/report-store.js';
export {
  ingestReportBuffer,
  syncReport,
  isIngestError,
} from './lib/report-sync.js';
export type { IngestOutcome, IngestError } from './lib/report-sync.js';

export {
  reconcileShipments,
  aggregateReceipts,
} from './lib/reconcile-shipments.js';
export type {
  ShippedLine,
  ReconciledLine,
  ShipmentReconciliation,
} from './lib/reconcile-shipments.js';

export {
  storeBoxLabel,
  listBoxLabels,
  boxLabelStorage,
  BoxLabelError,
} from './lib/box-label-store.js';
export type { StoredBoxLabel, BoxLabelInput } from './lib/box-label-store.js';
export {
  confirmPurchase,
  documentStorage,
  DocumentStoreError,
  getStoredDocument,
  listDocuments,
  purchaseGrouping,
  roleForRecognisedKind,
  setDocumentRole,
  storeExtractedDocument,
} from './lib/document-store.js';
export type {
  ListDocumentsFilters,
  RoleSource,
  StoreDocumentParams,
  StoredDocument,
  StoredRecognition,
} from './lib/document-store.js';
