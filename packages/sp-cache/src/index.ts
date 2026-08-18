export { SpCache } from './lib/sp-cache.js';
export type { SpCacheConfig } from './lib/sp-cache.js';
export {
  REPORTS,
  REPORT_KINDS,
  NUMERIC_FIELDS,
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
  readReportNumber,
  remapStoredRow,
} from './lib/report-ingest.js';
export type { ReportRow, ParseResult } from './lib/report-ingest.js';
export {
  storeReportRows,
  recordImport,
  getCoverage,
  queryLedgerRows,
  queryReceiptAggregates,
  queryReimbursements,
  queryReportAggregate,
  migrateReportRows,
  deleteReportRows,
  deleteReportImports,
  listImports,
  countRowsForImport,
  deleteImport,
  ReportQueryError,
  LEDGER_AUTHORITY,
} from './lib/report-store.js';
export type {
  ReportImport,
  ReportSource,
  Coverage,
  LedgerQuery,
  ReceiptAggregate,
  ReimbursementRow,
  ReportAggregate,
  ReportAggregateGroup,
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
  deleteBoxLabelsForAsset,
  boxLabelStorage,
  BoxLabelError,
} from './lib/box-label-store.js';
export type { StoredBoxLabel, BoxLabelInput } from './lib/box-label-store.js';
export {
  confirmPurchase,
  DOCUMENTS_COLLECTION,
  DOCUMENTS_DOMAIN,
  deleteStoredDocument,
  dismissSuggestedLink,
  documentStorage,
  DocumentStoreError,
  getStoredDocument,
  listDocuments,
  purchaseGrouping,
  roleForRecognisedKind,
  setDocumentRole,
  setDocumentShipment,
  storeExtractedDocument,
} from './lib/document-store.js';
export type {
  ListDocumentsFilters,
  RoleSource,
  StoreDocumentParams,
  StoredDocument,
  StoredRecognition,
} from './lib/document-store.js';
export {
  saveVendor,
  getVendor,
  listVendors,
  vendorStorage,
  VendorStoreError,
} from './lib/vendor-store.js';
export type { SaveVendorParams, StoredVendor } from './lib/vendor-store.js';
export {
  saveFcAddress,
  getFcAddress,
  listFcAddresses,
  fcStorage,
  FcStoreError,
} from './lib/fc-store.js';
export type { StoredFcAddress } from './lib/fc-store.js';
export {
  saveBuyerProfile,
  getBuyerProfile,
  buyerProfileStorage,
  BuyerProfileError,
} from './lib/buyer-profile-store.js';
export type { StoredBuyerProfile } from './lib/buyer-profile-store.js';
export {
  nextPoNumber,
  storePurchaseOrder,
  revisePurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrder,
  recordRenderedPo,
  detachRenderedPoAsset,
  listPurchaseOrders,
  poStorage,
  PoStoreError,
  setPurchaseOrderShipment,
} from './lib/po-store.js';
export type {
  ListPurchaseOrdersFilters,
  PurchaseOrderChanges,
  RenderedPo,
  StoredPurchaseOrder,
} from './lib/po-store.js';
export {
  reconcileSettlements,
  isPassThroughTax,
  economicRows,
  passThroughTaxResidual,
  resolveSku,
  collectKnownSkus,
  GRADE_CONDITIONS,
} from './lib/settlement-report.js';
export type {
  SettlementReconciliation,
  SkuIdentity,
} from './lib/settlement-report.js';
export {
  searchDocuments,
  suggestLinks,
  documentSearchText,
  documentSearchTransport,
  DocumentSearchError,
  DOCUMENT_SEARCH_INDEX,
  documentSearchIndexDefinition,
  documentSearchTypeKey,
  EMBEDDING_DIMENSIONS,
} from './lib/document-search.js';
export {
  requestAdsReport,
  collectAdsReport,
  adsRowsAsCsv,
  AdsReportSyncError,
} from './lib/ads-report-sync.js';
export type {
  AdsReportClient,
  CollectAdsReportResult,
} from './lib/ads-report-sync.js';
export {
  readAdsRun,
  writeAdsRun,
  listAdsRuns,
  adsRunId,
  adsSyncStorage,
  ingestedAdsWindows,
  overlapsIngestedWindow,
  AdsSyncStoreError,
} from './lib/ads-sync-store.js';
export type { AdsSyncRun, AdsSyncStatus } from './lib/ads-sync-store.js';
export type {
  DocumentSearchFilters,
  DocumentSearchHit,
  DocumentSearchResult,
  DocumentSearchFacets,
  SearchDocumentsParams,
  SuggestedLink,
} from './lib/document-search.js';

export {
  getPayoutBreakdown,
  buildPayouts,
  bucketFor,
} from './lib/payout-breakdown.js';
export type { Payout, PayoutBucket } from './lib/payout-breakdown.js';

export {
  storeFunnel,
  getFunnel,
  listFunnels,
  recordGraduation,
  getGraduation,
  settleGraduation,
  listGraduations,
  listDueNegatives,
  funnelStorage,
  FunnelStoreError,
} from './lib/funnel-store.js';
export type {
  StoredFunnel,
  StoredGraduation,
  ListGraduationsFilters,
} from './lib/funnel-store.js';

export { planHarvest, addDays } from './lib/keyword-harvest.js';
export type {
  HarvestRow,
  HarvestPlan,
  HarvestRefusal,
  HarvestOutcome,
  HarvestSkip,
  GraduationProposal,
  NegativeProposal,
  BudgetSignal,
  ExistingKeyword,
  PlanHarvestParams,
} from './lib/keyword-harvest.js';

export {
  applyGraduation,
  applyBackwardNegative,
  dueNegativeDecisions,
  HarvestApplyError,
} from './lib/harvest-apply.js';
export type {
  ApplyGraduationParams,
  ApplyGraduationResult,
  ApplyNegativeParams,
  ApplyNegativeResult,
  DeliveryEvidence,
  DueNegativeParams,
  HarvestWriteClient,
  NegativeDecision,
  ScheduledNegative,
} from './lib/harvest-apply.js';
