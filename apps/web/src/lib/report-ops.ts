import { SpApiClient } from '@farvisionllc/sp-client';
import {
  getCoverage,
  syncReport,
  isIngestError,
  type ReportKind,
} from '@amz-spapi/sp-cache';
import type { SellerReportOps } from '@amz-spapi/seller-agent';

/**
 * Host implementation of FBA report ingestion for the agent.
 *
 * Scoped to a seller, not a user: reports describe an Amazon account, and two
 * users on the same account must see one ledger.
 */
export function createReportOps(params: {
  sellerId: string;
  spClient: SpApiClient;
  marketplaceId: string;
}): SellerReportOps {
  return {
    async syncReport({ kind, from, to }) {
      const result = await syncReport({
        client: params.spClient,
        sellerId: params.sellerId,
        kind: kind as ReportKind,
        from,
        to,
        marketplaceIds: [params.marketplaceId],
      });
      if (isIngestError(result)) {
        return {
          kind,
          rowsParsed: 0,
          rowsNew: 0,
          rowsDuplicate: 0,
          error: result.error,
        };
      }
      return result;
    },
    getCoverage: ({ kind, from, to }) =>
      getCoverage({
        kind: kind as ReportKind,
        sellerId: params.sellerId,
        from,
        to,
      }),
  };
}
