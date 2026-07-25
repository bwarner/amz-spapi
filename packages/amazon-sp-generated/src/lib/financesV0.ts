export type paths = {
  '/finances/v0/financialEventGroups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns financial event groups for a given date range. Orders from the last 48 hours might not be included in financial events.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 0.5 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits).
     */
    get: operations['listFinancialEventGroups'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/finances/v0/financialEventGroups/{eventGroupId}/financialEvents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns all financial events for the specified financial event group. Orders from the last 48 hours might not be included in financial events.
     *
     *     **Note:** This operation only retrieves a group's data for the past two years. A request for data spanning more than two years produces an empty response.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 0.5 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits).
     */
    get: operations['listFinancialEventsByGroupId'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/finances/v0/financialEvents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns financial events for the specified data range. Orders from the last 48 hours might not be included in financial events.
     *
     *     **Note:** in `ListFinancialEvents`, deferred events don't show up in responses until they are released.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 0.5 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits).
     */
    get: operations['listFinancialEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/finances/v0/orders/{orderId}/financialEvents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns all financial events for the specified order. Orders from the last 48 hours might not be included in financial events.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 0.5 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits).
     */
    get: operations['listFinancialEventsByOrderId'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @description An event related to an Adhoc Disbursement. */
    AdhocDisbursementEvent: {
      PostedDate?: components['schemas']['Date'];
      TransactionAmount?: components['schemas']['Currency'];
      /** @description The identifier for the transaction. */
      TransactionId?: string;
      /** @description The type of transaction. For example, "Disbursed to Amazon Gift Card balance". */
      TransactionType?: string;
    };
    /** @description A list of `AdhocDisbursement` events. */
    AdhocDisbursementEventList: components['schemas']['AdhocDisbursementEvent'][];
    /** @description An adjustment to the seller's account. */
    AdjustmentEvent: {
      AdjustmentAmount?: components['schemas']['Currency'];
      AdjustmentItemList?: components['schemas']['AdjustmentItemList'];
      /**
       * @description The type of adjustment.
       *
       *     Possible values:
       *
       *     * `FBAInventoryReimbursement`: An FBA inventory reimbursement to a seller's account. This occurs if a seller's inventory is damaged.
       *     * `ReserveEvent`: A reserve event that is generated at the time a settlement period closes. This occurs when some money from a seller's account is held back.
       *     * `PostageBilling`: The amount paid by a seller for shipping labels.
       *     * `PostageRefund`: The reimbursement of shipping labels purchased for orders that were canceled or refunded.
       *     * `LostOrDamagedReimbursement`: An Amazon Easy Ship reimbursement to a seller's account for a package that we lost or damaged.
       *     * `CanceledButPickedUpReimbursement`: An Amazon Easy Ship reimbursement to a seller's account. This occurs when a package is picked up and the order is subsequently canceled. This value is used only in the India marketplace.
       *     * `ReimbursementClawback`: An Amazon Easy Ship reimbursement clawback from a seller's account. This occurs when a prior reimbursement is reversed. This value is used only in the India marketplace.
       *     * `SellerRewards`: An award credited to a seller's account for their participation in an offer in the Seller Rewards program. Applies only to the India marketplace.
       */
      AdjustmentType?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description The name of the store where the event occurred. */
      StoreName?: string;
    };
    /** @description A list of adjustment event information for the seller's account. */
    AdjustmentEventList: components['schemas']['AdjustmentEvent'][];
    /** @description An item in an adjustment to the seller's account. */
    AdjustmentItem: {
      /** @description The Amazon Standard Identification Number (ASIN) of the item. */
      ASIN?: string;
      /** @description A unique identifier assigned to products stored in and fulfilled from a fulfillment center. */
      FnSKU?: string;
      PerUnitAmount?: components['schemas']['Currency'];
      /** @description A short description of the item. */
      ProductDescription?: string;
      /** @description Represents the number of units in the seller's inventory when the `AdjustmentType` is `FBAInventoryReimbursement`. */
      Quantity?: string;
      /** @description The seller SKU of the item. The seller SKU is qualified by the seller's seller ID, which is included with every call to the Selling Partner API. */
      SellerSKU?: string;
      TotalAmount?: components['schemas']['Currency'];
      /** @description The transaction number that is related to the adjustment. */
      TransactionNumber?: string;
    };
    /** @description A list of information about items in an adjustment to the seller's account. */
    AdjustmentItemList: components['schemas']['AdjustmentItem'][];
    /** @description An expense related to an affordability promotion. */
    AffordabilityExpenseEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      BaseExpense?: components['schemas']['Currency'];
      /** @description The Amazon-defined marketplace identifier. */
      MarketplaceId?: string;
      PostedDate?: components['schemas']['Date'];
      TaxTypeCGST: components['schemas']['Currency'];
      TaxTypeIGST: components['schemas']['Currency'];
      TaxTypeSGST: components['schemas']['Currency'];
      TotalExpense?: components['schemas']['Currency'];
      /**
       * @description The type of transaction.
       *
       *     Possible values:
       *
       *     * `Charge`: an affordability promotion expense.
       *     * `Refund`: an affordability promotion expense reversal.
       */
      TransactionType?: string;
    };
    /** @description A list of expense information related to an affordability promotion. */
    AffordabilityExpenseEventList: components['schemas']['AffordabilityExpenseEvent'][];
    /** @description A signed decimal number. */
    BigDecimal: number;
    /** @description An event related to a capacity reservation billing charge. */
    CapacityReservationBillingEvent: {
      /** @description A short description of the capacity reservation billing event. */
      Description?: string;
      PostedDate?: components['schemas']['Date'];
      TransactionAmount?: components['schemas']['Currency'];
      /** @description The transaction type. For example, FBA Inventory Fee. */
      TransactionType?: string;
    };
    /** @description A list of `CapacityReservationBillingEvent` events. */
    CapacityReservationBillingEventList: components['schemas']['CapacityReservationBillingEvent'][];
    /**
     * @description A charge on the seller's account.
     *
     *     Possible values:
     *
     *     * `Principal`: The selling price of the order item, which is equal to the selling price of the item multiplied by the quantity ordered.
     *
     *     * `Tax`: The tax on the principal that is collected by the seller.
     *
     *     * `MarketplaceFacilitatorTax-Principal`: The tax that is withheld on the principal.
     *
     *     * `MarketplaceFacilitatorTax-Shipping`: The tax that is withheld on the `ShippingCharge`.
     *
     *     * `MarketplaceFacilitatorTax-Giftwrap`: The tax that is withheld on the Giftwrap charge.
     *
     *     * `MarketplaceFacilitatorTax-Other`: The tax that is withheld on other miscellaneous charges.
     *
     *     * `Discount`: The promotional discount for an order item.
     *
     *     * `TaxDiscount`: The tax that is deducted for promotional rebates.
     *
     *     * `CODItemCharge`: The COD charge for an order item.
     *
     *     * `CODItemTaxCharge`: The tax that is collected by the seller on a `CODItemCharge`.
     *
     *     * `CODOrderCharge`: The COD charge for an order.
     *
     *     * `CODOrderTaxCharge`: The tax that is collected by the seller on a `CODOrderCharge`.
     *
     *     * `CODShippingCharge`: Shipping charges for a COD order.
     *
     *     * `CODShippingTaxCharge`: The tax that is collected by the seller on a `CODShippingCharge`.
     *
     *     * `ShippingCharge`: The shipping charge.
     *
     *     * `ShippingTax`: The tax that is collected by the seller on a `ShippingCharge`.
     *
     *     * `Goodwill`: The amount of money that is given to a buyer as a gesture of goodwill or to compensate for pain and suffering in the buying experience.
     *
     *     * `Giftwrap`: The gift wrap charge.
     *
     *     * `GiftwrapTax`: The tax that is collected by the seller on a gift wrap charge.
     *
     *     * `RestockingFee`: The charge that is applied to the buyer when returning a product in certain categories.
     *
     *     * `ReturnShipping`: The amount of money that is given to the buyer to compensate for shipping the item back if we are at fault.
     *
     *     * `PointsFee`: The value of Amazon Points deducted from the refund if the buyer does not have enough Amazon Points to cover the deduction.
     *
     *     * `GenericDeduction`: A generic bad debt deduction.
     *
     *     * `FreeReplacementReturnShipping`: The compensation for return shipping when a buyer receives the wrong item, requests a free replacement, and returns the incorrect item.
     *
     *     * `PaymentMethodFee`: The fee that is collected for certain payment methods in certain marketplaces.
     *
     *     * `ExportCharge`: The export duty that is charged when an item is shipped to an international destination as part of the Amazon Global program.
     *
     *     * `SAFE-TReimbursement`: The SAFE-T claim amount for the item.
     *
     *     * `TCS-CGST`: Tax Collected at Source (TCS) for Central Goods and Services Tax (CGST).
     *
     *     * `TCS-SGST`: Tax Collected at Source for State Goods and Services Tax (SGST).
     *
     *     * `TCS-IGST`: Tax Collected at Source for Integrated Goods and Services Tax (IGST).
     *
     *     * `TCS-UTGST`: Tax Collected at Source for Union Territories Goods and Services Tax (UTGST).
     *
     *     * `PaidthroughEBT`: The amount of money paid with EBT for any order or shipment items.
     */
    ChargeComponent: {
      ChargeAmount?: components['schemas']['Currency'];
      /** @description The type of charge. */
      ChargeType?: string;
    };
    /** @description A list of charge information on the seller's account. */
    ChargeComponentList: components['schemas']['ChargeComponent'][];
    /** @description A payment instrument. */
    ChargeInstrument: {
      Amount?: components['schemas']['Currency'];
      /** @description A short description of the charge instrument. */
      Description?: string;
      /** @description The account tail (trailing digits) of the charge instrument. */
      Tail?: string;
    };
    /** @description A list of payment instruments. */
    ChargeInstrumentList: components['schemas']['ChargeInstrument'][];
    /** @description An event related to charge refund. */
    ChargeRefundEvent: {
      ChargeRefundTransactions?: components['schemas']['ChargeRefundTransactions'];
      PostedDate?: components['schemas']['Date'];
      /** @description The reason given for a charge refund. For example, `SubscriptionFeeCorrection`. */
      ReasonCode?: string;
      /** @description A description of the Reason Code. For example, `SubscriptionFeeCorrection`. */
      ReasonCodeDescription?: string;
    };
    /** @description A list of charge refund events. */
    ChargeRefundEventList: components['schemas']['ChargeRefundEvent'][];
    /** @description The charge refund transaction. */
    ChargeRefundTransaction: {
      ChargeAmount?: components['schemas']['Currency'];
      /** @description The type of charge. */
      ChargeType?: string;
    };
    /** @description A list of `ChargeRefund` transactions */
    ChargeRefundTransactions: components['schemas']['ChargeRefundTransaction'][];
    /** @description An event related to coupon payments. */
    CouponPaymentEvent: {
      ChargeComponent?: components['schemas']['ChargeComponent'];
      /**
       * Format: int64
       * @description The number of coupon clips or redemptions.
       */
      ClipOrRedemptionCount?: number;
      /** @description A coupon identifier. */
      CouponId?: string;
      FeeComponent?: components['schemas']['FeeComponent'];
      /** @description A payment event identifier. */
      PaymentEventId?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description The description provided by the seller when they created the coupon. */
      SellerCouponDescription?: string;
      TotalAmount?: components['schemas']['Currency'];
    };
    /** @description A list of coupon payment event information. */
    CouponPaymentEventList: components['schemas']['CouponPaymentEvent'][];
    /** @description A currency type and amount. */
    Currency: {
      CurrencyAmount?: components['schemas']['BigDecimal'];
      /** @description The three-digit currency code in ISO 4217 format. */
      CurrencyCode?: string;
    };
    /**
     * Format: date-time
     * @description A date in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
     */
    Date: string;
    /** @description A debt payment or debt adjustment. */
    DebtRecoveryEvent: {
      ChargeInstrumentList?: components['schemas']['ChargeInstrumentList'];
      DebtRecoveryItemList?: components['schemas']['DebtRecoveryItemList'];
      /**
       * @description The debt recovery type.
       *
       *     Possible values:
       *
       *     * `DebtPayment`
       *     * `DebtPaymentFailure`
       *     * `DebtAdjustment`
       */
      DebtRecoveryType?: string;
      OverPaymentCredit?: components['schemas']['Currency'];
      RecoveryAmount?: components['schemas']['Currency'];
    };
    /** @description A list of debt recovery event information. */
    DebtRecoveryEventList: components['schemas']['DebtRecoveryEvent'][];
    /** @description An item of a debt payment or debt adjustment. */
    DebtRecoveryItem: {
      GroupBeginDate?: components['schemas']['Date'];
      GroupEndDate?: components['schemas']['Date'];
      OriginalAmount?: components['schemas']['Currency'];
      RecoveryAmount?: components['schemas']['Currency'];
    };
    /** @description A list of debt recovery item information. */
    DebtRecoveryItemList: components['schemas']['DebtRecoveryItem'][];
    /** @description A payment made directly to a seller. */
    DirectPayment: {
      DirectPaymentAmount?: components['schemas']['Currency'];
      /**
       * @description The type of payment.
       *
       *     Possible values:
       *
       *     * `StoredValueCardRevenue` - The amount that is deducted from the seller's account because the seller received money through a stored value card.
       *
       *     * `StoredValueCardRefund` - The amount that Amazon returns to the seller if the order that is purchased using a stored value card is refunded.
       *
       *     * `PrivateLabelCreditCardRevenue` - The amount that is deducted from the seller's account because the seller received money through a private label credit card offered by Amazon.
       *
       *     * `PrivateLabelCreditCardRefund` - The amount that Amazon returns to the seller if the order that is purchased using a private label credit card offered by Amazon is refunded.
       *
       *     * `CollectOnDeliveryRevenue` - The COD amount that the seller collected directly from the buyer.
       *
       *     * `CollectOnDeliveryRefund` - The amount that Amazon refunds to the buyer if an order paid for by COD is refunded.
       */
      DirectPaymentType?: string;
    };
    /** @description A list of direct payment information. */
    DirectPaymentList: components['schemas']['DirectPayment'][];
    /** @description An EBT refund reimbursement event. */
    EBTRefundReimbursementOnlyEvent: {
      Amount?: components['schemas']['Currency'];
      /** @description The identifier of an order. */
      OrderId?: string;
      PostedDate?: components['schemas']['Date'];
    };
    /** @description A list of EBT refund reimbursement events. */
    EBTRefundReimbursementOnlyEventList: components['schemas']['EBTRefundReimbursementOnlyEvent'][];
    /** @description Error response returned when the request is unsuccessful. */
    Error: {
      /** @description An error code that identifies the type of error that occurred. */
      code: string;
      /** @description Additional details that can help the caller understand or fix the issue. */
      details?: string;
      /** @description A message that describes the error condition in a human-readable form. */
      message: string;
    };
    /** @description A list of error responses returned when a request is unsuccessful. */
    ErrorList: components['schemas']['Error'][];
    /** @description Failed ad hoc disbursement event list. */
    FailedAdhocDisbursementEvent: {
      /** @description The disbursement identifier. */
      DisbursementId?: string;
      /** @description The type of fund transfer. For example, `Refund`. */
      FundsTransfersType?: string;
      /** @description The type of payment for disbursement. For example, `CREDIT_CARD`. */
      PaymentDisbursementType?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description The status of the failed `AdhocDisbursement`. For example, `HARD_DECLINED`. */
      Status?: string;
      TransferAmount?: components['schemas']['Currency'];
      /** @description The transfer identifier. */
      TransferId?: string;
    };
    /** @description A list of `FailedAdhocDisbursementEvent`. */
    FailedAdhocDisbursementEventList: components['schemas']['FailedAdhocDisbursementEvent'][];
    /** @description A payment event for Fulfillment by Amazon (FBA) inventory liquidation. This event is used only in the US marketplace. */
    FBALiquidationEvent: {
      LiquidationFeeAmount?: components['schemas']['Currency'];
      LiquidationProceedsAmount?: components['schemas']['Currency'];
      /** @description The identifier for the original removal order. */
      OriginalRemovalOrderId?: string;
      PostedDate?: components['schemas']['Date'];
    };
    /** @description A list of FBA inventory liquidation payment events. */
    FBALiquidationEventList: components['schemas']['FBALiquidationEvent'][];
    /** @description A fee associated with the event. */
    FeeComponent: {
      FeeAmount?: components['schemas']['Currency'];
      /** @description The type of fee. For more information about Selling on Amazon fees, see [Selling on Amazon Fee Schedule](https://sellercentral.amazon.com/gp/help/200336920) on Seller Central. For more information about Fulfillment by Amazon fees, see [FBA features, services and fees](https://sellercentral.amazon.com/gp/help/201074400) on Seller Central. */
      FeeType?: string;
    };
    /** @description A list of fee component information. */
    FeeComponentList: components['schemas']['FeeComponent'][];
    /** @description Information related to a financial event group. */
    FinancialEventGroup: {
      /** @description The account tail of the payment instrument. */
      AccountTail?: string;
      BeginningBalance?: components['schemas']['Currency'];
      ConvertedTotal?: components['schemas']['Currency'];
      FinancialEventGroupEnd?: components['schemas']['Date'];
      /** @description A unique identifier for the financial event group. */
      FinancialEventGroupId?: string;
      FinancialEventGroupStart?: components['schemas']['Date'];
      FundTransferDate?: components['schemas']['Date'];
      /** @description The status of the fund transfer. */
      FundTransferStatus?: string;
      OriginalTotal?: components['schemas']['Currency'];
      /**
       * @description The processing status of the financial event group indicates whether the balance of the financial event group is settled.
       *
       *     Possible values:
       *
       *     * `Open`
       *     * `Closed`
       */
      ProcessingStatus?: string;
      /** @description The trace identifier used by sellers to look up transactions externally. */
      TraceId?: string;
    };
    /** @description A list of financial event group information. */
    FinancialEventGroupList: components['schemas']['FinancialEventGroup'][];
    /** @description All the information that is related to a financial event. */
    FinancialEvents: {
      AdhocDisbursementEventList?: components['schemas']['AdhocDisbursementEventList'];
      AdjustmentEventList?: components['schemas']['AdjustmentEventList'];
      AffordabilityExpenseEventList?: components['schemas']['AffordabilityExpenseEventList'];
      AffordabilityExpenseReversalEventList?: components['schemas']['AffordabilityExpenseEventList'];
      CapacityReservationBillingEventList?: components['schemas']['CapacityReservationBillingEventList'];
      ChargebackEventList?: components['schemas']['ShipmentEventList'];
      ChargeRefundEventList?: components['schemas']['ChargeRefundEventList'];
      CouponPaymentEventList?: components['schemas']['CouponPaymentEventList'];
      DebtRecoveryEventList?: components['schemas']['DebtRecoveryEventList'];
      EBTRefundReimbursementOnlyEventList?: components['schemas']['EBTRefundReimbursementOnlyEventList'];
      FailedAdhocDisbursementEventList?: components['schemas']['FailedAdhocDisbursementEventList'];
      FBALiquidationEventList?: components['schemas']['FBALiquidationEventList'];
      GuaranteeClaimEventList?: components['schemas']['ShipmentEventList'];
      ImagingServicesFeeEventList?: components['schemas']['ImagingServicesFeeEventList'];
      LoanServicingEventList?: components['schemas']['LoanServicingEventList'];
      NetworkComminglingTransactionEventList?: components['schemas']['NetworkComminglingTransactionEventList'];
      PayWithAmazonEventList?: components['schemas']['PayWithAmazonEventList'];
      ProductAdsPaymentEventList?: components['schemas']['ProductAdsPaymentEventList'];
      RefundEventList?: components['schemas']['ShipmentEventList'];
      RemovalShipmentAdjustmentEventList?: components['schemas']['RemovalShipmentAdjustmentEventList'];
      RemovalShipmentEventList?: components['schemas']['RemovalShipmentEventList'];
      RentalTransactionEventList?: components['schemas']['RentalTransactionEventList'];
      RetrochargeEventList?: components['schemas']['RetrochargeEventList'];
      SAFETReimbursementEventList?: components['schemas']['SAFETReimbursementEventList'];
      SellerDealPaymentEventList?: components['schemas']['SellerDealPaymentEventList'];
      SellerReviewEnrollmentPaymentEventList?: components['schemas']['SellerReviewEnrollmentPaymentEventList'];
      ServiceFeeEventList?: components['schemas']['ServiceFeeEventList'];
      ServiceProviderCreditEventList?: components['schemas']['SolutionProviderCreditEventList'];
      ShipmentEventList?: components['schemas']['ShipmentEventList'];
      ShipmentSettleEventList?: components['schemas']['ShipmentSettleEventList'];
      TaxWithholdingEventList?: components['schemas']['TaxWithholdingEventList'];
      TDSReimbursementEventList?: components['schemas']['TDSReimbursementEventList'];
      TrialShipmentEventList?: components['schemas']['TrialShipmentEventList'];
      ValueAddedServiceChargeEventList?: components['schemas']['ValueAddedServiceChargeEventList'];
    };
    /** @description A fee event related to Amazon Imaging services. */
    ImagingServicesFeeEvent: {
      /** @description The Amazon Standard Identification Number (ASIN) of the item for which the imaging service was requested. */
      ASIN?: string;
      FeeList?: components['schemas']['FeeComponentList'];
      /** @description The identifier for the imaging services request. */
      ImagingRequestBillingItemID?: string;
      PostedDate?: components['schemas']['Date'];
    };
    /** @description A list of fee events related to Amazon Imaging services. */
    ImagingServicesFeeEventList: components['schemas']['ImagingServicesFeeEvent'][];
    /** @description The payload for the `listFinancialEventGroups` operation. */
    ListFinancialEventGroupsPayload: {
      FinancialEventGroupList?: components['schemas']['FinancialEventGroupList'];
      /** @description When present and not empty, pass this string token in the next request to return the next response page. */
      NextToken?: string;
    };
    /** @description The response schema for the `listFinancialEventGroups` operation. */
    ListFinancialEventGroupsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['ListFinancialEventGroupsPayload'];
    };
    /** @description The payload for the `listFinancialEvents` operation. */
    ListFinancialEventsPayload: {
      FinancialEvents?: components['schemas']['FinancialEvents'];
      /** @description When present and not empty, pass this string token in the next request to return the next response page. */
      NextToken?: string;
    };
    /** @description The response schema for the `listFinancialEvents` operation. */
    ListFinancialEventsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['ListFinancialEventsPayload'];
    };
    /** @description A loan advance, loan payment, or loan refund. */
    LoanServicingEvent: {
      LoanAmount?: components['schemas']['Currency'];
      /**
       * @description The type of event.
       *
       *     Possible values:
       *
       *     * `LoanAdvance`
       *
       *     * `LoanPayment`
       *
       *     * `LoanRefund`
       */
      SourceBusinessEventType?: string;
    };
    /** @description A list of loan servicing events. */
    LoanServicingEventList: components['schemas']['LoanServicingEvent'][];
    /** @description A network commingling transaction event. */
    NetworkComminglingTransactionEvent: {
      /** @description The Amazon Standard Identification Number (ASIN) of the swapped item. */
      ASIN?: string;
      /** @description The marketplace in which the event took place. */
      MarketplaceId?: string;
      /** @description The identifier for the network item swap. */
      NetCoTransactionID?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description The reason for the network item swap. */
      SwapReason?: string;
      TaxAmount?: components['schemas']['Currency'];
      TaxExclusiveAmount?: components['schemas']['Currency'];
      /**
       * @description The type of network item swap.
       *
       *     Possible values:
       *
       *     * `NetCo`: A Fulfillment by Amazon inventory pooling transaction. Available only in the India marketplace.
       *
       *     * `ComminglingVAT`: A commingling VAT transaction. Available only in the Spain, UK, France, Germany, and Italy marketplaces.
       */
      TransactionType?: string;
    };
    /** @description A list of network commingling transaction events. */
    NetworkComminglingTransactionEventList: components['schemas']['NetworkComminglingTransactionEvent'][];
    /** @description An event related to the seller's Pay with Amazon account. */
    PayWithAmazonEvent: {
      /** @description A short description of this payment event. */
      AmountDescription?: string;
      /** @description The type of business object. */
      BusinessObjectType?: string;
      Charge?: components['schemas']['ChargeComponent'];
      FeeList?: components['schemas']['FeeComponentList'];
      /**
       * @description The fulfillment channel.
       *
       *     Possible values:
       *
       *     * `AFN`: Amazon Fulfillment Network (Fulfillment by Amazon)
       *
       *     * `MFN`: Merchant Fulfillment Network (self-fulfilled)
       */
      FulfillmentChannel?: string;
      /**
       * @description The type of payment.
       *
       *     Possible values:
       *
       *     * `Sales`
       */
      PaymentAmountType?: string;
      /** @description The sales channel for the transaction. */
      SalesChannel?: string;
      /** @description An order identifier that is specified by the seller. */
      SellerOrderId?: string;
      /** @description The name of the store where the event occurred. */
      StoreName?: string;
      TransactionPostedDate?: components['schemas']['Date'];
    };
    /** @description A list of events related to the seller's Pay with Amazon account. */
    PayWithAmazonEventList: components['schemas']['PayWithAmazonEvent'][];
    /** @description A Sponsored Products payment event. */
    ProductAdsPaymentEvent: {
      baseValue?: components['schemas']['Currency'];
      /** @description The identifier for the invoice that includes the transaction. */
      invoiceId?: string;
      postedDate?: components['schemas']['Date'];
      taxValue?: components['schemas']['Currency'];
      /**
       * @description Indicates if the transaction is for a charge or a refund.
       *
       *     Possible values:
       *
       *     * `charge`
       *
       *     * `refund`
       */
      transactionType?: string;
      transactionValue?: components['schemas']['Currency'];
    };
    /** @description A list of sponsored products payment events. */
    ProductAdsPaymentEventList: components['schemas']['ProductAdsPaymentEvent'][];
    /** @description A promotion applied to an item. */
    Promotion: {
      PromotionAmount?: components['schemas']['Currency'];
      /** @description The seller-specified identifier for the promotion. */
      PromotionId?: string;
      /** @description The type of promotion. */
      PromotionType?: string;
    };
    /** @description A list of promotions. */
    PromotionList: components['schemas']['Promotion'][];
    /** @description A financial adjustment event for FBA liquidated inventory. A positive value indicates money owed to Amazon by the buyer (for example, when the charge was incorrectly calculated as less than it should be). A negative value indicates a full or partial refund owed to the buyer (for example, when the buyer receives damaged items or fewer items than ordered). */
    RemovalShipmentAdjustmentEvent: {
      /** @description The unique identifier for the adjustment event. */
      AdjustmentEventId?: string;
      /** @description The merchant removal orderId. */
      MerchantOrderId?: string;
      /** @description The orderId for shipping inventory. */
      OrderId?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description A comma-delimited list of `RemovalShipmentItemAdjustment` details for FBA inventory. */
      RemovalShipmentItemAdjustmentList?: components['schemas']['RemovalShipmentItemAdjustment'][];
      /**
       * @description The type of removal order.
       *
       *     Possible values:
       *
       *     * `WHOLESALE_LIQUIDATION`.
       */
      TransactionType?: string;
    };
    /** @description A comma-delimited list of `RemovalShipmentAdjustment` details for FBA inventory. */
    RemovalShipmentAdjustmentEventList: components['schemas']['RemovalShipmentAdjustmentEvent'][];
    /** @description A removal shipment event for a removal order. */
    RemovalShipmentEvent: {
      /** @description The merchant removal `orderId`. */
      MerchantOrderId?: string;
      /** @description The identifier for the removal shipment order. */
      OrderId?: string;
      PostedDate?: components['schemas']['Date'];
      RemovalShipmentItemList?: components['schemas']['RemovalShipmentItemList'];
      /** @description The name of the store where the event occurred. */
      StoreName?: string;
      /**
       * @description The type of removal order.
       *
       *     Possible values:
       *
       *     * `WHOLESALE_LIQUIDATION`
       */
      TransactionType?: string;
    };
    /** @description A list of removal shipment event information. */
    RemovalShipmentEventList: components['schemas']['RemovalShipmentEvent'][];
    /** @description Item-level information for a removal shipment. */
    RemovalShipmentItem: {
      FeeAmount?: components['schemas']['Currency'];
      /** @description The Amazon fulfillment network SKU for the item. */
      FulfillmentNetworkSKU?: string;
      /**
       * Format: int32
       * @description The quantity of the item.
       */
      Quantity?: number;
      /** @description An identifier for an item in a removal shipment. */
      RemovalShipmentItemId?: string;
      Revenue?: components['schemas']['Currency'];
      TaxAmount?: components['schemas']['Currency'];
      /**
       * @description The tax collection model that is applied to the item.
       *
       *     Possible values:
       *
       *     * `MarketplaceFacilitator`: Tax is withheld and remitted to the taxing authority by Amazon on behalf of the seller.
       *     * `Standard`: Tax is paid to the seller and not remitted to the taxing authority by Amazon.
       */
      TaxCollectionModel?: string;
      TaxWithheld?: components['schemas']['Currency'];
    };
    /** @description Item-level information for a removal shipment item adjustment. */
    RemovalShipmentItemAdjustment: {
      /**
       * Format: int32
       * @description Adjusted quantity of `RemovalShipmentItemAdjustment` items.
       */
      AdjustedQuantity?: number;
      /** @description The Amazon fulfillment network SKU for the item. */
      FulfillmentNetworkSKU?: string;
      /** @description An identifier for an item in a removal shipment. */
      RemovalShipmentItemId?: string;
      RevenueAdjustment?: components['schemas']['Currency'];
      TaxAmountAdjustment?: components['schemas']['Currency'];
      /**
       * @description The tax collection model that is applied to the item.
       *
       *     Possible values:
       *
       *     * `MarketplaceFacilitator`: Tax is withheld and remitted to the taxing authority by Amazon on behalf of the seller.
       *     * `Standard`: Tax is paid to the seller and not remitted to the taxing authority by Amazon.
       */
      TaxCollectionModel?: string;
      TaxWithheldAdjustment?: components['schemas']['Currency'];
    };
    /** @description A list of `RemovalShipmentItem`. */
    RemovalShipmentItemList: components['schemas']['RemovalShipmentItem'][];
    /** @description An event related to a rental transaction. */
    RentalTransactionEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      /**
       * Format: int32
       * @description The number of days that the buyer extended an already rented item. This value is only returned for `RentalCustomerPayment-Extension` and `RentalCustomerRefund-Extension` events.
       */
      ExtensionLength?: number;
      /** @description The name of the marketplace. */
      MarketplaceName?: string;
      PostedDate?: components['schemas']['Date'];
      RentalChargeList?: components['schemas']['ChargeComponentList'];
      /**
       * @description The type of rental event.
       *
       *     Possible values:
       *
       *     * `RentalCustomerPayment-Buyout`: A transaction type that represents when the customer wants to buy out a rented item.
       *
       *     * `RentalCustomerPayment-Extension`: A transaction type that represents when the customer wants to extend the rental period.
       *
       *     * `RentalCustomerRefund-Buyout`: A transaction type that represents when the customer requests a refund for the buyout of the rented item.
       *
       *     * `RentalCustomerRefund-Extension`: A transaction type that represents when the customer requests a refund over the extension on the rented item.
       *
       *     * `RentalHandlingFee`: A transaction type that represents the fee that Amazon charges sellers who rent through Amazon.
       *
       *     * `RentalChargeFailureReimbursement`: A transaction type that represents when Amazon sends money to the seller to compensate for a failed charge.
       *
       *     * `RentalLostItemReimbursement`: A transaction type that represents when Amazon sends money to the seller to compensate for a lost item.
       */
      RentalEventType?: string;
      RentalFeeList?: components['schemas']['FeeComponentList'];
      RentalInitialValue?: components['schemas']['Currency'];
      RentalReimbursement?: components['schemas']['Currency'];
      RentalTaxWithheldList?: components['schemas']['TaxWithheldComponentList'];
    };
    /** @description A list of rental transaction event information. */
    RentalTransactionEventList: components['schemas']['RentalTransactionEvent'][];
    /** @description A retrocharge or retrocharge reversal. */
    RetrochargeEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      BaseTax?: components['schemas']['Currency'];
      /** @description The name of the marketplace where the retrocharge event occurred. */
      MarketplaceName?: string;
      PostedDate?: components['schemas']['Date'];
      /**
       * @description The type of event.
       *
       *     Possible values:
       *
       *     * `Retrocharge`
       *
       *     * `RetrochargeReversal`
       */
      RetrochargeEventType?: string;
      RetrochargeTaxWithheldList?: components['schemas']['TaxWithheldComponentList'];
      ShippingTax?: components['schemas']['Currency'];
    };
    /** @description A list of information about `Retrocharge` or `RetrochargeReversal` events. */
    RetrochargeEventList: components['schemas']['RetrochargeEvent'][];
    /** @description A SAFE-T claim reimbursement on the seller's account. */
    SAFETReimbursementEvent: {
      PostedDate?: components['schemas']['Date'];
      /** @description Indicates why the seller was reimbursed. */
      ReasonCode?: string;
      ReimbursedAmount?: components['schemas']['Currency'];
      /** @description A SAFE-T claim identifier. */
      SAFETClaimId?: string;
      SAFETReimbursementItemList?: components['schemas']['SAFETReimbursementItemList'];
    };
    /** @description A list of `SAFETReimbursementEvent`. */
    SAFETReimbursementEventList: components['schemas']['SAFETReimbursementEvent'][];
    /** @description An item from a SAFE-T claim reimbursement. */
    SAFETReimbursementItem: {
      itemChargeList?: components['schemas']['ChargeComponentList'];
      /** @description The description of the item as shown on the product detail page on the retail website. */
      productDescription?: string;
      /** @description The number of units of the item being reimbursed. */
      quantity?: string;
    };
    /** @description A list of `SAFETReimbursementItem`. */
    SAFETReimbursementItemList: components['schemas']['SAFETReimbursementItem'][];
    /** @description An event linked to the payment of a fee related to the specified deal. */
    SellerDealPaymentEvent: {
      /** @description The internal description of the deal. */
      dealDescription?: string;
      /** @description The unique identifier of the deal. */
      dealId?: string;
      /** @description The type of event: `SellerDealComplete`. */
      eventType?: string;
      feeAmount?: components['schemas']['Currency'];
      /** @description The type of fee: `RunLightningDealFee`. */
      feeType?: string;
      postedDate?: components['schemas']['Date'];
      taxAmount?: components['schemas']['Currency'];
      totalAmount?: components['schemas']['Currency'];
    };
    /** @description A list of payment events for deal-related fees. */
    SellerDealPaymentEventList: components['schemas']['SellerDealPaymentEvent'][];
    /** @description A fee payment event for the Early Reviewer Program. */
    SellerReviewEnrollmentPaymentEvent: {
      ChargeComponent?: components['schemas']['ChargeComponent'];
      /** @description An enrollment identifier. */
      EnrollmentId?: string;
      FeeComponent?: components['schemas']['FeeComponent'];
      /** @description The Amazon Standard Identification Number (ASIN) of the item that was enrolled in the Early Reviewer Program. */
      ParentASIN?: string;
      PostedDate?: components['schemas']['Date'];
      TotalAmount?: components['schemas']['Currency'];
    };
    /** @description A list of information about fee events for the Early Reviewer Program. */
    SellerReviewEnrollmentPaymentEventList: components['schemas']['SellerReviewEnrollmentPaymentEvent'][];
    /** @description A service fee on the seller's account. */
    ServiceFeeEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      /** @description The Amazon Standard Identification Number (ASIN) of the item. */
      ASIN?: string;
      /** @description A short description of the service fee event. */
      FeeDescription?: string;
      FeeList?: components['schemas']['FeeComponentList'];
      /** @description A short description of the service fee reason. */
      FeeReason?: string;
      /** @description A unique identifier assigned by Amazon to products stored in and fulfilled from an Amazon fulfillment center. */
      FnSKU?: string;
      /** @description The seller SKU of the item. The seller SKU is qualified by the seller's seller ID, which is included with every call to the Selling Partner API. */
      SellerSKU?: string;
      /** @description The name of the store where the event occurred. */
      StoreName?: string;
    };
    /** @description A list of information about service fee events. */
    ServiceFeeEventList: components['schemas']['ServiceFeeEvent'][];
    /** @description A shipment, refund, guarantee claim, or chargeback. */
    ShipmentEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      DirectPaymentList?: components['schemas']['DirectPaymentList'];
      /** @description The name of the marketplace where the event occurred. */
      MarketplaceName?: string;
      OrderChargeAdjustmentList?: components['schemas']['ChargeComponentList'];
      OrderChargeList?: components['schemas']['ChargeComponentList'];
      OrderFeeAdjustmentList?: components['schemas']['FeeComponentList'];
      OrderFeeList?: components['schemas']['FeeComponentList'];
      PostedDate?: components['schemas']['Date'];
      /** @description A seller-defined identifier for an order. */
      SellerOrderId?: string;
      ShipmentFeeAdjustmentList?: components['schemas']['FeeComponentList'];
      ShipmentFeeList?: components['schemas']['FeeComponentList'];
      ShipmentItemAdjustmentList?: components['schemas']['ShipmentItemList'];
      ShipmentItemList?: components['schemas']['ShipmentItemList'];
      /** @description The name of the store where the event occurred. */
      StoreName?: string;
    };
    /** @description A list of shipment event information. */
    ShipmentEventList: components['schemas']['ShipmentEvent'][];
    /** @description An item of a shipment, refund, guarantee claim, or chargeback. */
    ShipmentItem: {
      CostOfPointsGranted?: components['schemas']['Currency'];
      CostOfPointsReturned?: components['schemas']['Currency'];
      ItemChargeAdjustmentList?: components['schemas']['ChargeComponentList'];
      ItemChargeList?: components['schemas']['ChargeComponentList'];
      ItemFeeAdjustmentList?: components['schemas']['FeeComponentList'];
      ItemFeeList?: components['schemas']['FeeComponentList'];
      ItemTaxWithheldList?: components['schemas']['TaxWithheldComponentList'];
      /** @description An Amazon-defined order adjustment identifier defined for refunds, guarantee claims, and chargeback events. */
      OrderAdjustmentItemId?: string;
      /** @description An Amazon-defined order item identifier. */
      OrderItemId?: string;
      PromotionAdjustmentList?: components['schemas']['PromotionList'];
      PromotionList?: components['schemas']['PromotionList'];
      /**
       * Format: int32
       * @description The number of items shipped.
       */
      QuantityShipped?: number;
      /** @description The seller SKU of the item. The seller SKU is qualified by the seller's seller ID, which is included with every call to the Selling Partner API. */
      SellerSKU?: string;
    };
    /** @description A list of shipment items. */
    ShipmentItemList: components['schemas']['ShipmentItem'][];
    /** @description A list of `ShipmentEvent` items. */
    ShipmentSettleEventList: components['schemas']['ShipmentEvent'][];
    /** @description A credit given to a solution provider. */
    SolutionProviderCreditEvent: {
      /** @description The two-letter country code of the country associated with the marketplace where the order was placed. */
      MarketplaceCountryCode?: string;
      /** @description The identifier of the marketplace where the order was placed. */
      MarketplaceId?: string;
      /** @description The Amazon-defined identifier of the solution provider. */
      ProviderId?: string;
      /** @description The store name where the payment event occurred. */
      ProviderStoreName?: string;
      /** @description The transaction type. */
      ProviderTransactionType?: string;
      /** @description The Amazon-defined identifier of the seller. */
      SellerId?: string;
      /** @description A seller-defined identifier for an order. */
      SellerOrderId?: string;
      /** @description The store name where the payment event occurred. */
      SellerStoreName?: string;
      TransactionAmount?: components['schemas']['Currency'];
      TransactionCreationDate?: components['schemas']['Date'];
    };
    /** @description A list of `SolutionProviderCreditEvent`. */
    SolutionProviderCreditEventList: components['schemas']['SolutionProviderCreditEvent'][];
    /** @description Information about the taxes withheld. */
    TaxWithheldComponent: {
      /**
       * @description The tax collection model applied to the item.
       *
       *     Possible values:
       *
       *     * `MarketplaceFacilitator`: Tax is withheld and remitted to the taxing authority by Amazon on behalf of the seller.
       *     * `Standard`: Tax is paid to the seller and not remitted to the taxing authority by Amazon.
       */
      TaxCollectionModel?: string;
      TaxesWithheld?: components['schemas']['ChargeComponentList'];
    };
    /** @description A list of information about taxes withheld. */
    TaxWithheldComponentList: components['schemas']['TaxWithheldComponent'][];
    /** @description A tax withholding event on a seller's account. */
    TaxWithholdingEvent: {
      BaseAmount?: components['schemas']['Currency'];
      PostedDate?: components['schemas']['Date'];
      TaxWithholdingPeriod?: components['schemas']['TaxWithholdingPeriod'];
      WithheldAmount?: components['schemas']['Currency'];
    };
    /** @description A list of tax withholding events. */
    TaxWithholdingEventList: components['schemas']['TaxWithholdingEvent'][];
    /** @description The period during which tax withholding on a seller's account is calculated. */
    TaxWithholdingPeriod: {
      EndDate?: components['schemas']['Date'];
      StartDate?: components['schemas']['Date'];
    };
    /** @description An event related to a Tax-Deducted-at-Source (TDS) reimbursement. */
    TDSReimbursementEvent: {
      PostedDate?: components['schemas']['Date'];
      ReimbursedAmount?: components['schemas']['Currency'];
      /** @description The Tax-Deducted-at-Source (TDS) identifier. */
      TDSOrderId?: string;
    };
    /** @description A list of `TDSReimbursementEvent` items. */
    TDSReimbursementEventList: components['schemas']['TDSReimbursementEvent'][];
    /** @description An event related to a trial shipment. */
    TrialShipmentEvent: {
      /** @description An Amazon-defined identifier for an order. */
      AmazonOrderId?: string;
      FeeList?: components['schemas']['FeeComponentList'];
      /** @description The identifier of the financial event group. */
      FinancialEventGroupId?: string;
      PostedDate?: components['schemas']['Date'];
      /** @description The seller SKU of the item. The seller SKU is qualified by the seller's seller ID, which is included with every call to the Selling Partner API. */
      SKU?: string;
    };
    /** @description A list of information about trial shipment financial events. */
    TrialShipmentEventList: components['schemas']['TrialShipmentEvent'][];
    /** @description An event related to a value added service charge. */
    ValueAddedServiceChargeEvent: {
      /** @description A short description of the service charge event. */
      Description?: string;
      PostedDate?: components['schemas']['Date'];
      TransactionAmount?: components['schemas']['Currency'];
      /** @description The transaction type. For example, 'Other Support Service fees' */
      TransactionType?: string;
    };
    /** @description A list of `ValueAddedServiceCharge` events. */
    ValueAddedServiceChargeEventList: components['schemas']['ValueAddedServiceChargeEvent'][];
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  listFinancialEventGroups: {
    parameters: {
      query?: {
        /** @description A date that selects financial event groups that opened after (or at) a specified date and time, in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. The date-time must be more than two minutes before you submit the request. */
        FinancialEventGroupStartedAfter?: string;
        /** @description A date that selects financial event groups that opened before (but not at) a specified date and time, in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. The date-time must be after `FinancialEventGroupStartedAfter` and more than two minutes before the time of request. If `FinancialEventGroupStartedAfter` and `FinancialEventGroupStartedBefore` are more than 180 days apart, no financial event groups are returned. */
        FinancialEventGroupStartedBefore?: string;
        /** @description The maximum number of results per page. If the response exceeds the maximum number of transactions or 10 MB, the response is `InvalidInput`. */
        MaxResultsPerPage?: number;
        /** @description The response includes `nextToken` when the number of results exceeds the specified `pageSize` value. To get the next page of results, call the operation with this token and include the same arguments as the call that produced the token. To get a complete list, call this operation until `nextToken` is null. Note that this operation can return empty pages. */
        NextToken?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description Request has missing or invalid parameters and cannot be parsed. */
      400: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
      403: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description The resource specified does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description The frequency of requests was greater than allowed. */
      429: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
      500: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
      /** @description Temporary overloading or maintenance of the server. */
      503: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventGroupsResponse'];
        };
      };
    };
  };
  listFinancialEventsByGroupId: {
    parameters: {
      query?: {
        /** @description The maximum number of results to return per page. If the response exceeds the maximum number of transactions or 10 MB, the response is `InvalidInput`. */
        MaxResultsPerPage?: number;
        /** @description The response includes `nextToken` when the number of results exceeds the specified `pageSize` value. To get the next page of results, call the operation with this token and include the same arguments as the call that produced the token. To get a complete list, call this operation until `nextToken` is null. Note that this operation can return empty pages. */
        NextToken?: string;
        /** @description The response includes financial events posted after (or on) this date. This date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format. The date-time must be more than two minutes before the time of the request. */
        PostedAfter?: string;
        /**
         * @description The response includes financial events posted before (but not on) this date. This date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         *
         *     The date-time must be later than `PostedAfter` and more than two minutes before the request was submitted. If `PostedAfter` and `PostedBefore` are more than 180 days apart, the response is empty. If you include the `PostedBefore` parameter in your request, you must also specify the `PostedAfter` parameter.
         *
         *     **Default:** Two minutes before the time of the request.
         */
        PostedBefore?: string;
      };
      header?: never;
      path: {
        /** @description The identifier of the financial event group to which the events belong. */
        eventGroupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Request has missing or invalid parameters and cannot be parsed. */
      400: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
      403: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The resource specified does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The frequency of requests was greater than allowed. */
      429: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
      500: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Temporary overloading or maintenance of the server. */
      503: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
    };
  };
  listFinancialEvents: {
    parameters: {
      query?: {
        /** @description The maximum number of results to return per page. If the response exceeds the maximum number of transactions or 10 MB, the response is `InvalidInput`. */
        MaxResultsPerPage?: number;
        /** @description The response includes `nextToken` when the number of results exceeds the specified `pageSize` value. To get the next page of results, call the operation with this token and include the same arguments as the call that produced the token. To get a complete list, call this operation until `nextToken` is null. Note that this operation can return empty pages. */
        NextToken?: string;
        /** @description The response includes financial events posted after (or on) this date. This date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format. The date-time must be more than two minutes before the time of the request. */
        PostedAfter?: string;
        /**
         * @description The response includes financial events posted before (but not on) this date. This date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         *
         *     The date-time must be later than `PostedAfter` and more than two minutes before the request was submitted. If `PostedAfter` and `PostedBefore` are more than 180 days apart, the response is empty. If you include the `PostedBefore` parameter in your request, you must also specify the `PostedAfter` parameter.
         *
         *     **Default:** Two minutes before the time of the request.
         */
        PostedBefore?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Request has missing or invalid parameters and cannot be parsed. */
      400: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
      403: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The resource specified does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The frequency of requests was greater than allowed. */
      429: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
      500: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Temporary overloading or maintenance of the server. */
      503: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
    };
  };
  listFinancialEventsByOrderId: {
    parameters: {
      query?: {
        /** @description The maximum number of results to return per page. If the response exceeds the maximum number of transactions or 10 MB, the response is `InvalidInput`. */
        MaxResultsPerPage?: number;
        /** @description The response includes `nextToken` when the number of results exceeds the specified `pageSize` value. To get the next page of results, call the operation with this token and include the same arguments as the call that produced the token. To get a complete list, call this operation until `nextToken` is null. Note that this operation can return empty pages. */
        NextToken?: string;
      };
      header?: never;
      path: {
        /** @description An Amazon-defined order identifier, in 3-7-7 format. */
        orderId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Financial Events successfully retrieved. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Request has missing or invalid parameters and cannot be parsed. */
      400: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
      403: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The resource specified does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description The frequency of requests was greater than allowed. */
      429: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
      500: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
      /** @description Temporary overloading or maintenance of the server. */
      503: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListFinancialEventsResponse'];
        };
      };
    };
  };
}
