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
  deleteReportRows,
  deleteReportImports,
  LEDGER_AUTHORITY,
} from './lib/report-store.js';
export type {
  ReportImport,
  ReportSource,
  Coverage,
  LedgerQuery,
} from './lib/report-store.js';
export {
  ingestReportBuffer,
  syncReport,
  isIngestError,
} from './lib/report-sync.js';
export type { IngestOutcome, IngestError } from './lib/report-sync.js';

export { reconcileShipments } from './lib/reconcile-shipments.js';
export type {
  ShippedLine,
  ReconciledLine,
  ShipmentReconciliation,
} from './lib/reconcile-shipments.js';
