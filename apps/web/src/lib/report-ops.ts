import { SpApiClient, REPORT_TIMEOUT_MS } from '@farvisionllc/sp-client';
import {
  getCoverage,
  queryLedgerRows,
  queryReportAggregate,
  getPayoutBreakdown,
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
        // Explicit, because this runs inside a chat turn that has 300s in
        // total for the model, every other tool, and streaming. Inheriting a
        // library default is how this came to wait ten minutes in a five
        // minute request.
        timeoutMs: REPORT_TIMEOUT_MS.requestSafe,
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
    // Reads stored rows only — never reaches Amazon. An unsynced window looks
    // exactly like a window with no movements, which is why the tool insists on
    // a coverage check rather than reporting an empty result as "nothing
    // happened".
    queryLedgerRows: ({ view, from, to, fnsku, granularity }) =>
      queryLedgerRows({
        sellerId: params.sellerId,
        view,
        from,
        to,
        fnsku,
        granularity,
      }),
    // Also stored rows only, and the same caveat applies: a total of nothing is
    // not a total of zero. A ReportQueryError from an unknown field name names
    // the valid ones, so it is allowed to reach the tool and be read there
    // rather than being flattened into "failed".
    queryReportAggregate: async ({
      kind,
      measure,
      groupBy,
      from,
      to,
      filters,
    }) => {
      const result = await queryReportAggregate({
        sellerId: params.sellerId,
        kind: kind as ReportKind,
        measure,
        groupBy,
        from,
        to,
        filters,
      });
      return {
        ...result,
        groups: result.groups.map((group) => ({
          ...group,
          key: group.key as Record<string, string | null>,
        })),
      };
    },

    getPayoutBreakdown: async ({ from, to }) =>
      getPayoutBreakdown({ sellerId: params.sellerId, from, to }),
  };
}
