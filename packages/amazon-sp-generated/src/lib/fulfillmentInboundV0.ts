export type paths = {
  '/fba/inbound/v0/prepInstructions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns labeling requirements and item preparation instructions to help prepare items for shipment to Amazon's fulfillment network.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getPrepInstructions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/fba/inbound/v0/shipmentItems': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns a list of items in a specified inbound shipment, or a list of items that were updated within a specified time frame.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getShipmentItems'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/fba/inbound/v0/shipments': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns a list of inbound shipments based on criteria that you specify.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getShipments'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/fba/inbound/v0/shipments/{shipmentId}/billOfLading': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns a bill of lading for a Less Than Truckload/Full Truckload (LTL/FTL) shipment. The getBillOfLading operation returns PDF document data for printing a bill of lading for an Amazon-partnered Less Than Truckload/Full Truckload (LTL/FTL) inbound shipment.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getBillOfLading'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/fba/inbound/v0/shipments/{shipmentId}/items': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns a list of items in a specified inbound shipment.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getShipmentItemsByShipmentId'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/fba/inbound/v0/shipments/{shipmentId}/labels': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns package/pallet labels for faster and more accurate shipment processing at the Amazon fulfillment center.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 2 | 30 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The table above indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput may see higher rate and burst values than those shown here. For more information, see [Usage Plans and Rate Limits in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['getLabels'];
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
    /** @description Specific details to identify a place. */
    Address: {
      /** @description The street address information. */
      AddressLine1: string;
      /** @description Additional street address information, if required. */
      AddressLine2?: string;
      /** @description The city. */
      City: string;
      /** @description The country code in two-character ISO 3166-1 alpha-2 format. */
      CountryCode: string;
      /** @description The district or county. */
      DistrictOrCounty?: string;
      /** @description Name of the individual or business. */
      Name: string;
      /**
       * @description The postal code.
       *
       *     If postal codes are used in your marketplace, we recommended that you include one with your request. This helps Amazon select the most appropriate Amazon fulfillment center for the inbound shipment plan.
       */
      PostalCode: string;
      /**
       * @description The state or province code.
       *
       *     If state or province codes are used in your marketplace, it is recommended that you include one with your request. This helps Amazon to select the most appropriate Amazon fulfillment center for your inbound shipment plan.
       */
      StateOrProvinceCode: string;
    };
    /** @description The fees for Amazon to prep goods for shipment. */
    AmazonPrepFeesDetails: {
      FeePerUnit?: components['schemas']['Amount'];
      PrepInstruction?: components['schemas']['PrepInstruction'];
    };
    /** @description A list of preparation instructions and fees for Amazon to prep goods for shipment. */
    AmazonPrepFeesDetailsList: components['schemas']['AmazonPrepFeesDetails'][];
    /** @description The monetary value. */
    Amount: {
      CurrencyCode: components['schemas']['CurrencyCode'];
      Value: components['schemas']['BigDecimalType'];
    };
    /** @description Item preparation instructions to help with item sourcing decisions. */
    ASINPrepInstructions: {
      /** @description The Amazon Standard Identification Number (ASIN) of the item. */
      ASIN?: string;
      BarcodeInstruction?: components['schemas']['BarcodeInstruction'];
      PrepGuidance?: components['schemas']['PrepGuidance'];
      PrepInstructionList?: components['schemas']['PrepInstructionList'];
    };
    /** @description A list of item preparation instructions. */
    ASINPrepInstructionsList: components['schemas']['ASINPrepInstructions'][];
    /**
     * @description Labeling requirements for the item. For more information about FBA labeling requirements, see the Seller Central Help for your marketplace.
     * @enum {string}
     */
    BarcodeInstruction:
      | 'RequiresFNSKULabel'
      | 'CanUseOriginalBarcode'
      | 'MustProvideSellerSKU';
    /**
     * Format: double
     * @description Number format that supports decimal.
     */
    BigDecimalType: number;
    /** @description Download URL for the bill of lading. */
    BillOfLadingDownloadURL: {
      /** @description URL to download the bill of lading for the package. Note: The URL will only be valid for 15 seconds */
      DownloadURL?: string;
    };
    /** @description The manual processing fee per unit and total fee for a shipment. */
    BoxContentsFeeDetails: {
      FeePerUnit?: components['schemas']['Amount'];
      TotalFee?: components['schemas']['Amount'];
      TotalUnits?: components['schemas']['Quantity'];
    };
    /**
     * @description Where the seller provided box contents information for a shipment.
     * @enum {string}
     */
    BoxContentsSource: 'NONE' | 'FEED' | '2D_BARCODE' | 'INTERACTIVE';
    /**
     * @description The currency code.
     * @enum {string}
     */
    CurrencyCode: 'USD' | 'GBP';
    /**
     * Format: date
     * @description Type containing date in string format
     */
    DateStringType: string;
    /** @description Error response returned when the request is unsuccessful. */
    Error: {
      /** @description An error code that identifies the type of error that occured. */
      code: string;
      /** @description Additional details that can help the caller understand or fix the issue. */
      details?: string;
      /** @description A message that describes the error condition in a human-readable form. */
      message: string;
    };
    /** @description A list of error responses returned when a request is unsuccessful. */
    ErrorList: components['schemas']['Error'][];
    /**
     * @description The reason that the ASIN is invalid.
     * @enum {string}
     */
    ErrorReason: 'DoesNotExist' | 'InvalidASIN';
    /** @description The response schema for the getBillOfLading operation. */
    GetBillOfLadingResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['BillOfLadingDownloadURL'];
    };
    /** @description The response schema for the getLabels operation. */
    GetLabelsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['LabelDownloadURL'];
    };
    /** @description The response schema for the getPrepInstructions operation. */
    GetPrepInstructionsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['GetPrepInstructionsResult'];
    };
    /** @description Result for the get prep instructions operation */
    GetPrepInstructionsResult: {
      ASINPrepInstructionsList?: components['schemas']['ASINPrepInstructionsList'];
      InvalidASINList?: components['schemas']['InvalidASINList'];
      InvalidSKUList?: components['schemas']['InvalidSKUList'];
      SKUPrepInstructionsList?: components['schemas']['SKUPrepInstructionsList'];
    };
    /** @description The response schema for the getShipmentItems operation. */
    GetShipmentItemsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['GetShipmentItemsResult'];
    };
    /** @description Result for the get shipment items operation */
    GetShipmentItemsResult: {
      ItemData?: components['schemas']['InboundShipmentItemList'];
      /** @description When present and not empty, pass this string token in the next request to return the next response page. */
      NextToken?: string;
    };
    /** @description The response schema for the getShipments operation. */
    GetShipmentsResponse: {
      errors?: components['schemas']['ErrorList'];
      payload?: components['schemas']['GetShipmentsResult'];
    };
    /** @description Result for the get shipments operation */
    GetShipmentsResult: {
      /** @description When present and not empty, pass this string token in the next request to return the next response page. */
      NextToken?: string;
      ShipmentData?: components['schemas']['InboundShipmentList'];
    };
    /** @description Information about the seller's inbound shipments. Returned by the listInboundShipments operation. */
    InboundShipmentInfo: {
      /** @description Indicates whether or not an inbound shipment contains case-packed boxes. When AreCasesRequired = true for an inbound shipment, all items in the inbound shipment must be case packed. */
      AreCasesRequired: boolean;
      BoxContentsSource?: components['schemas']['BoxContentsSource'];
      ConfirmedNeedByDate?: components['schemas']['DateStringType'];
      /** @description An Amazon fulfillment center identifier created by Amazon. */
      DestinationFulfillmentCenterId?: string;
      EstimatedBoxContentsFee?: components['schemas']['BoxContentsFeeDetails'];
      LabelPrepType?: components['schemas']['LabelPrepType'];
      ShipFromAddress: components['schemas']['Address'];
      /** @description The shipment identifier submitted in the request. */
      ShipmentId?: string;
      /** @description The name for the inbound shipment. */
      ShipmentName?: string;
      ShipmentStatus?: components['schemas']['ShipmentStatus'];
    };
    /** @description Item information for an inbound shipment. Submitted with a call to the createInboundShipment or updateInboundShipment operation. */
    InboundShipmentItem: {
      /** @description Amazon's fulfillment network SKU of the item. */
      FulfillmentNetworkSKU?: string;
      PrepDetailsList?: components['schemas']['PrepDetailsList'];
      QuantityInCase?: components['schemas']['Quantity'];
      QuantityReceived?: components['schemas']['Quantity'];
      QuantityShipped: components['schemas']['Quantity'];
      ReleaseDate?: components['schemas']['DateStringType'];
      /** @description The seller SKU of the item. */
      SellerSKU: string;
      /** @description A shipment identifier originally returned by the createInboundShipmentPlan operation. */
      ShipmentId?: string;
    };
    /** @description A list of inbound shipment item information. */
    InboundShipmentItemList: components['schemas']['InboundShipmentItem'][];
    /** @description A list of inbound shipment information. */
    InboundShipmentList: components['schemas']['InboundShipmentInfo'][];
    /** @description Contains details about an invalid ASIN */
    InvalidASIN: {
      /** @description The Amazon Standard Identification Number (ASIN) of the item. */
      ASIN?: string;
      ErrorReason?: components['schemas']['ErrorReason'];
    };
    /** @description A list of invalid ASIN values and the reasons they are invalid. */
    InvalidASINList: components['schemas']['InvalidASIN'][];
    /** @description Contains detail about an invalid SKU */
    InvalidSKU: {
      ErrorReason?: components['schemas']['ErrorReason'];
      /** @description The seller SKU of the item. */
      SellerSKU?: string;
    };
    /** @description A list of invalid SKU values and the reason they are invalid. */
    InvalidSKUList: components['schemas']['InvalidSKU'][];
    /** @description Download URL for a label */
    LabelDownloadURL: {
      /** @description URL to download the label for the package. Note: The URL will only be valid for 15 seconds */
      DownloadURL?: string;
    };
    /**
     * @description The type of label preparation that is required for the inbound shipment.
     * @enum {string}
     */
    LabelPrepType: 'NO_LABEL' | 'SELLER_LABEL' | 'AMAZON_LABEL';
    /** @description Preparation instructions and who is responsible for the preparation. */
    PrepDetails: {
      PrepInstruction: components['schemas']['PrepInstruction'];
      PrepOwner: components['schemas']['PrepOwner'];
    };
    /** @description A list of preparation instructions and who is responsible for that preparation. */
    PrepDetailsList: components['schemas']['PrepDetails'][];
    /**
     * @description Item preparation instructions.
     * @enum {string}
     */
    PrepGuidance:
      | 'ConsultHelpDocuments'
      | 'NoAdditionalPrepRequired'
      | 'SeePrepInstructionsList';
    /**
     * @description Preparation instructions for shipping an item to Amazon's fulfillment network. For more information about preparing items for shipment to Amazon's fulfillment network, see the Seller Central Help for your marketplace.
     * @enum {string}
     */
    PrepInstruction:
      | 'Polybagging'
      | 'BubbleWrapping'
      | 'Taping'
      | 'BlackShrinkWrapping'
      | 'Labeling'
      | 'HangGarment'
      | 'SetCreation'
      | 'Boxing'
      | 'RemoveFromHanger'
      | 'Debundle'
      | 'SuffocationStickering'
      | 'CapSealing'
      | 'SetStickering'
      | 'BlankStickering'
      | 'ShipsInProductPackaging'
      | 'NoPrep';
    /** @description A list of preparation instructions to help with item sourcing decisions. */
    PrepInstructionList: components['schemas']['PrepInstruction'][];
    /**
     * @description Indicates who will prepare the item.
     * @enum {string}
     */
    PrepOwner: 'AMAZON' | 'SELLER';
    /**
     * Format: int32
     * @description The item quantity.
     */
    Quantity: number;
    /**
     * @description Indicates the status of the inbound shipment. When used with the createInboundShipment operation, WORKING is the only valid value. When used with the updateInboundShipment operation, possible values are WORKING, SHIPPED or CANCELLED.
     * @enum {string}
     */
    ShipmentStatus:
      | 'WORKING'
      | 'SHIPPED'
      | 'RECEIVING'
      | 'CANCELLED'
      | 'DELETED'
      | 'CLOSED'
      | 'ERROR'
      | 'IN_TRANSIT'
      | 'DELIVERED'
      | 'CHECKED_IN';
    /** @description Labeling requirements and item preparation instructions to help you prepare items for shipment to Amazon's fulfillment network. */
    SKUPrepInstructions: {
      AmazonPrepFeesDetailsList?: components['schemas']['AmazonPrepFeesDetailsList'];
      /** @description The Amazon Standard Identification Number (ASIN) of the item. */
      ASIN?: string;
      BarcodeInstruction?: components['schemas']['BarcodeInstruction'];
      PrepGuidance?: components['schemas']['PrepGuidance'];
      PrepInstructionList?: components['schemas']['PrepInstructionList'];
      /** @description The seller SKU of the item. */
      SellerSKU?: string;
    };
    /** @description A list of SKU labeling requirements and item preparation instructions. */
    SKUPrepInstructionsList: components['schemas']['SKUPrepInstructions'][];
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  getPrepInstructions: {
    parameters: {
      query: {
        /**
         * @description A list of ASIN values. Used to identify items for which you want item preparation instructions to help with item sourcing decisions.
         *
         *     Note: ASINs must be included in the product catalog for at least one of the marketplaces that the seller  participates in. Any ASIN that is not included in the product catalog for at least one of the marketplaces that the seller participates in is returned in the InvalidASINList property in the response. You can find out which marketplaces a seller participates in by calling the getMarketplaceParticipations operation in the Selling Partner API for Sellers.
         */
        ASINList?: string[];
        /**
         * @description A list of SellerSKU values. Used to identify items for which you want labeling requirements and item preparation instructions for shipment to Amazon's fulfillment network. The SellerSKU is qualified by the Seller ID, which is included with every call to the Seller Partner API.
         *
         *     Note: Include seller SKUs that you have used to list items on Amazon's retail website. If you include a seller SKU that you have never used to list an item on Amazon's retail website, the seller SKU is returned in the InvalidSKUList property in the response.
         */
        SellerSKUList?: string[];
        /** @description The country code of the country to which the items will be shipped. Note that labeling requirements and item preparation instructions can vary by country. */
        ShipToCountryCode: string;
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
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
          'application/json': components['schemas']['GetPrepInstructionsResponse'];
        };
      };
    };
  };
  getShipmentItems: {
    parameters: {
      query: {
        /** @description A date used for selecting inbound shipment items that were last updated after (or at) a specified time. The selection includes updates made by Amazon and by the seller. */
        LastUpdatedAfter?: string;
        /** @description A date used for selecting inbound shipment items that were last updated before (or at) a specified time. The selection includes updates made by Amazon and by the seller. */
        LastUpdatedBefore?: string;
        /** @description A marketplace identifier. Specifies the marketplace where the product would be stored. */
        MarketplaceId: string;
        /** @description A string token returned in the response to your previous request. */
        NextToken?: string;
        /** @description Indicates whether items are returned using a date range (by providing the LastUpdatedAfter and LastUpdatedBefore parameters), or using NextToken, which continues returning items specified in a previous request. */
        QueryType: 'DATE_RANGE' | 'NEXT_TOKEN';
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
    };
  };
  getShipments: {
    parameters: {
      query: {
        /** @description A date used for selecting inbound shipments that were last updated after (or at) a specified time. The selection includes updates made by Amazon and by the seller. */
        LastUpdatedAfter?: string;
        /** @description A date used for selecting inbound shipments that were last updated before (or at) a specified time. The selection includes updates made by Amazon and by the seller. */
        LastUpdatedBefore?: string;
        /** @description A marketplace identifier. Specifies the marketplace where the product would be stored. */
        MarketplaceId: string;
        /** @description A string token returned in the response to your previous request. */
        NextToken?: string;
        /** @description Indicates whether shipments are returned using shipment information (by providing the ShipmentStatusList or ShipmentIdList parameters), using a date range (by providing the LastUpdatedAfter and LastUpdatedBefore parameters), or by using NextToken to continue returning items specified in a previous request. */
        QueryType: 'SHIPMENT' | 'DATE_RANGE' | 'NEXT_TOKEN';
        /** @description A list of shipment IDs used to select the shipments that you want. If both ShipmentStatusList and ShipmentIdList are specified, only shipments that match both parameters are returned. */
        ShipmentIdList?: string[];
        /** @description A list of ShipmentStatus values. Used to select shipments with a current status that matches the status values that you specify. */
        ShipmentStatusList?: (
          | 'WORKING'
          | 'READY_TO_SHIP'
          | 'SHIPPED'
          | 'RECEIVING'
          | 'CANCELLED'
          | 'DELETED'
          | 'CLOSED'
          | 'ERROR'
          | 'IN_TRANSIT'
          | 'DELIVERED'
          | 'CHECKED_IN'
        )[];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentsResponse'];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentsResponse'];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
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
          'application/json': components['schemas']['GetShipmentsResponse'];
        };
      };
    };
  };
  getBillOfLading: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description A shipment identifier originally returned by the createInboundShipmentPlan operation. */
        shipmentId: string;
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetBillOfLadingResponse'];
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetBillOfLadingResponse'];
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
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
          'application/json': components['schemas']['GetBillOfLadingResponse'];
        };
      };
    };
  };
  getShipmentItemsByShipmentId: {
    parameters: {
      query?: {
        /** @description Deprecated. Do not use. */
        MarketplaceId?: string;
      };
      header?: never;
      path: {
        /** @description A shipment identifier used for selecting items in a specific inbound shipment. */
        shipmentId: string;
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
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
          'application/json': components['schemas']['GetShipmentItemsResponse'];
        };
      };
    };
  };
  getLabels: {
    parameters: {
      query: {
        /** @description The type of labels requested. */
        LabelType: 'BARCODE_2D' | 'UNIQUE' | 'PALLET';
        /** @description The number of packages in the shipment. */
        NumberOfPackages?: number;
        /** @description The number of pallets in the shipment. This returns four identical labels for each pallet. */
        NumberOfPallets?: number;
        /**
         * @description A list of identifiers that specify packages for which you want package labels printed.
         *
         *     If you provide box content information with the [FBA Inbound Shipment Carton Information Feed](https://developer-docs.amazon.com/sp-api/docs/fulfillment-by-amazon-feed-type-values#fba-inbound-shipment-carton-information-feed), then `PackageLabelsToPrint` must match the `CartonId` values you provide through that feed. If you provide box content information with the Fulfillment Inbound API v2024-03-20, then `PackageLabelsToPrint` must match the `boxID` values from the [`listShipmentBoxes`](https://developer-docs.amazon.com/sp-api/reference/listshipmentboxes) response. If these values do not match as required, the operation returns the `IncorrectPackageIdentifier` error code.
         */
        PackageLabelsToPrint?: string[];
        /** @description The page size for paginating through the total packages' labels. This is a required parameter for Non-Partnered LTL Shipments. Max value:1000. */
        PageSize?: number;
        /** @description The page start index for paginating through the total packages' labels. This is a required parameter for Non-Partnered LTL Shipments. */
        PageStartIndex?: number;
        /** @description The page type to use to print the labels. Submitting a PageType value that is not supported in your marketplace returns an error. */
        PageType:
          | 'PackageLabel_Letter_2'
          | 'PackageLabel_Letter_4'
          | 'PackageLabel_Letter_6'
          | 'PackageLabel_Letter_6_CarrierLeft'
          | 'PackageLabel_A4_2'
          | 'PackageLabel_A4_4'
          | 'PackageLabel_Plain_Paper'
          | 'PackageLabel_Plain_Paper_CarrierBottom'
          | 'PackageLabel_Thermal'
          | 'PackageLabel_Thermal_Unified'
          | 'PackageLabel_Thermal_NonPCP'
          | 'PackageLabel_Thermal_No_Carrier_Rotation';
      };
      header?: never;
      path: {
        /** @description A shipment identifier originally returned by the createInboundShipmentPlan operation. */
        shipmentId: string;
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
          'application/json': components['schemas']['GetLabelsResponse'];
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
          'application/json': components['schemas']['GetLabelsResponse'];
        };
      };
      /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
      401: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetLabelsResponse'];
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
          'application/json': components['schemas']['GetLabelsResponse'];
        };
      };
      /** @description The specified resource does not exist. */
      404: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GetLabelsResponse'];
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
          'application/json': components['schemas']['GetLabelsResponse'];
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
          'application/json': components['schemas']['GetLabelsResponse'];
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
          'application/json': components['schemas']['GetLabelsResponse'];
        };
      };
    };
  };
}
