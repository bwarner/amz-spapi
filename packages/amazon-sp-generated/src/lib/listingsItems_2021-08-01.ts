export type paths = {
  '/listings/2021-08-01/items/{sellerId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Search for and return a list of selling partner listings items and their respective details.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 5 | 5 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that are applied to the requested operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api).
     */
    get: operations['searchListingsItems'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/listings/2021-08-01/items/{sellerId}/{sku}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Returns details about a listings item for a selling partner.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 5 | 10 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can receive higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api) in the Selling Partner API documentation.
     */
    get: operations['getListingsItem'];
    /**
     * @description Creates a new or fully-updates an existing listings item for a selling partner.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 5 | 10 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can receive higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api) in the Selling Partner API documentation.
     */
    put: operations['putListingsItem'];
    post?: never;
    /**
     * @description Delete a listings item for a selling partner.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 5 | 5 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can receive higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api) in the Selling Partner API documentation.
     */
    delete: operations['deleteListingsItem'];
    options?: never;
    head?: never;
    /**
     * @description Partially update (patch) a listings item for a selling partner. Only top-level listings item attributes can be patched. Patching nested attributes is not supported.
     *
     *     **Usage Plan:**
     *
     *     | Rate (requests per second) | Burst |
     *     | ---- | ---- |
     *     | 5 | 5 |
     *
     *     The `x-amzn-RateLimit-Limit` response header returns the usage plan rate limits that were applied to the requested operation, when available. The preceding table indicates the default rate and burst values for this operation. Selling partners whose business demands require higher throughput can receive higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api) in the Selling Partner API documentation.
     */
    patch: operations['patchListingsItem'];
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @description Buyer segment or program this offer is applicable to. */
    Audience: {
      /** @description Localized display name for the audience. */
      displayName?: string;
      /**
       * @description Name of the audience an offer is applicable to.
       *
       *     Common values:
       *
       *     * 'ALL' - Standard offer audience for buyers on Amazon retail websites.
       *
       *     * 'B2B' - Offer audience for Amazon Business website buyers.
       * @example ALL
       */
      value?: string;
    };
    /** @description A decimal number with no loss of precision. Useful when precision loss is unnaceptable, as with currencies. Follows RFC7159 for number representation. */
    Decimal: string;
    /** @description Error response returned when the request is unsuccessful. */
    Error: {
      /** @description An error code that identifies the type of error that occurred. */
      code: string;
      /** @description Additional details that can help the caller understand or fix the issue. */
      details?: string;
      /** @description A message that describes the error condition. */
      message: string;
    };
    /** @description A list of error responses returned when a request is unsuccessful. */
    ErrorList: {
      errors: components['schemas']['Error'][];
    };
    /** @description The fulfillment availability details for the listings item. */
    FulfillmentAvailability: {
      /** @description Designates which fulfillment network is used. */
      fulfillmentChannelCode: string;
      /** @description The quantity of the item you are making available for sale. */
      quantity?: number;
    };
    /** @description An issue with a listings item. */
    Issue: {
      /** @description The names of the attributes associated with the issue, if applicable. */
      attributeNames?: string[];
      /**
       * @description List of issue categories.
       *
       *     Possible values:
       *
       *     * 'INVALID_ATTRIBUTE' - Indicating an invalid attribute in the listing.
       *
       *     * 'MISSING_ATTRIBUTE' - Highlighting a missing attribute in the listing.
       *
       *     * 'INVALID_IMAGE' - Signifying an invalid image in the listing.
       *
       *     * 'MISSING_IMAGE' - Noting the absence of an image in the listing.
       *
       *     * 'INVALID_PRICE' - Pertaining to issues with the listing's price-related attributes.
       *
       *     * 'MISSING_PRICE' - Pointing out the absence of a price attribute in the listing.
       *
       *     * 'DUPLICATE' - Identifying listings with potential duplicate problems, such as this ASIN potentially being a duplicate of another ASIN.
       *
       *     * 'QUALIFICATION_REQUIRED' - Indicating that the listing requires qualification-related approval.
       * @example [
       *       "INVALID_ATTRIBUTE"
       *     ]
       */
      categories: string[];
      /** @description An issue code that identifies the type of issue. */
      code: string;
      enforcements?: components['schemas']['IssueEnforcements'];
      /** @description A message that describes the issue. */
      message: string;
      /**
       * @description The severity of the issue.
       * @enum {string}
       */
      severity: 'ERROR' | 'WARNING' | 'INFO';
    };
    /** @description The enforcement action taken by Amazon that affect the publishing or status of a listing */
    IssueEnforcementAction: {
      /**
       * @description The enforcement action name.
       *
       *     Possible values:
       *
       *     * `LISTING_SUPPRESSED` - This enforcement takes down the current listing item's buyability.
       *
       *     * `ATTRIBUTE_SUPPRESSED` - An attribute's value on the listing item is invalid, which causes it to be rejected by Amazon.
       *
       *     * `CATALOG_ITEM_REMOVED` - This catalog item is inactive on Amazon, and all offers against it in the applicable marketplace are non-buyable.
       *
       *     * `SEARCH_SUPPRESSED` - This value indicates that the catalog item is hidden from search results.
       * @example LISTING_SUPPRESSED
       */
      action: string;
    };
    /** @description This field provides information about the enforcement actions taken by Amazon that affect the publishing or status of a listing. It also includes details about any associated exemptions. */
    IssueEnforcements: {
      /** @description List of enforcement actions taken by Amazon that affect the publishing or status of a listing. */
      actions: components['schemas']['IssueEnforcementAction'][];
      exemption: components['schemas']['IssueExemption'];
    };
    /** @description Conveying the status of the listed enforcement actions and, if applicable, provides information about the exemption's expiry date. */
    IssueExemption: {
      /**
       * Format: date-time
       * @description Represents the timestamp, in ISO 8601 format, that specifies the date when the temporary exemptions expires, and Amazon begins enforcing the listed actions.
       * @example 2023-10-28T00:36:48.914Z
       */
      expiryDate?: string;
      /**
       * @description This field indicates the current exemption status for the listed enforcement actions. It can take values such as `EXEMPT`, signifying permanent exemption, `EXEMPT_UNTIL_EXPIRY_DATE` indicating temporary exemption until a specified date, or `NOT_EXEMPT` signifying no exemptions, and enforcement actions were already applied.
       * @enum {string}
       */
      status: 'EXEMPT' | 'EXEMPT_UNTIL_EXPIRY_DATE' | 'NOT_EXEMPT';
    };
    /** @description A listings item. */
    Item: {
      attributes?: components['schemas']['ItemAttributes'];
      /** @description The fulfillment availability for the listings item. */
      fulfillmentAvailability?: components['schemas']['FulfillmentAvailability'][];
      issues?: components['schemas']['ItemIssues'];
      offers?: components['schemas']['ItemOffers'];
      /** @description The vendor procurement information for the listings item. */
      procurement?: components['schemas']['ItemProcurement'][];
      productTypes?: components['schemas']['ItemProductTypes'];
      relationships?: components['schemas']['ItemRelationships'];
      /** @description A selling partner provided identifier for an Amazon listing. */
      sku: string;
      summaries?: components['schemas']['ItemSummaries'];
    };
    /** @description A JSON object containing structured listings item attribute data keyed by attribute name. */
    ItemAttributes: {
      [key: string]: unknown;
    };
    /** @description Identity attributes associated with the item in the Amazon catalog, such as the ASIN. */
    ItemIdentifiers: components['schemas']['ItemIdentifiersByMarketplace'][];
    /** @description Identity attributes associated with the item in the Amazon catalog for the indicated Amazon marketplace. */
    ItemIdentifiersByMarketplace: {
      /** @description Amazon Standard Identification Number (ASIN) of the listings item. */
      asin?: string;
      /** @description A marketplace identifier. Identifies the Amazon marketplace for the listings item. */
      marketplaceId?: string;
    };
    /** @description The image for the listings item. */
    ItemImage: {
      /** @description The height of the image in pixels. */
      height: number;
      /** @description The link, or URL, to the image. */
      link: string;
      /** @description The width of the image in pixels. */
      width: number;
    };
    /** @description The issues associated with the listings item. */
    ItemIssues: components['schemas']['Issue'][];
    /** @description Offer details of a listings item for an Amazon marketplace. */
    ItemOfferByMarketplace: {
      audience?: components['schemas']['Audience'];
      /** @description The Amazon marketplace identifier. */
      marketplaceId: string;
      /**
       * @description Type of offer for the listings item.
       * @enum {string}
       */
      offerType: 'B2C' | 'B2B';
      points?: components['schemas']['Points'];
      price: components['schemas']['Money'];
    };
    /** @description Offer details for the listings item. */
    ItemOffers: components['schemas']['ItemOfferByMarketplace'][];
    /** @description The vendor procurement information for the listings item. */
    ItemProcurement: {
      costPrice: components['schemas']['Money'];
    };
    /** @description Product types that are associated with the listing item for the specified marketplace. */
    ItemProductTypeByMarketplace: {
      /** @description Amazon marketplace identifier. */
      marketplaceId: string;
      /**
       * @description The name of the product type that is submitted by the Selling Partner.
       * @example LUGGAGE
       */
      productType: string;
    };
    /** @description Product types for a listing item, by marketplace. */
    ItemProductTypes: components['schemas']['ItemProductTypeByMarketplace'][];
    /** @description The relationship details for a listing item. */
    ItemRelationship: {
      /** @description Identifiers (SKUs) of the related items that are children of this listing item. */
      childSkus?: string[];
      /** @description Identifiers (SKUs) of the related items that are parents of this listing item. */
      parentSkus?: string[];
      /**
       * @description The type of relationship.
       * @example VARIATION
       * @enum {string}
       */
      type: 'VARIATION' | 'PACKAGE_HIERARCHY';
      variationTheme?: components['schemas']['ItemVariationTheme'];
    };
    /** @description Relationships for a listing item, by marketplace (for example, variations). */
    ItemRelationships: components['schemas']['ItemRelationshipsByMarketplace'][];
    /** @description Relationship details for the listing item in the specified marketplace. */
    ItemRelationshipsByMarketplace: {
      /** @description Amazon marketplace identifier. */
      marketplaceId: string;
      /** @description Relationships for the listing item. */
      relationships: components['schemas']['ItemRelationship'][];
    };
    /** @description Selling partner listings items and search related metadata. */
    ItemSearchResults: {
      /** @description A list of listings items. */
      items: components['schemas']['Item'][];
      /**
       * @description The total number of selling partner listings items found for the search criteria (only results up to the page count limit is returned per request regardless of the number found).
       *
       *     Note: The maximum number of items (SKUs) that can be returned and paged through is 1000.
       */
      numberOfResults: number;
      pagination?: components['schemas']['Pagination'];
    };
    /** @description Summary details of a listings item. */
    ItemSummaries: components['schemas']['ItemSummaryByMarketplace'][];
    /** @description Summary details of a listings item for an Amazon marketplace. */
    ItemSummaryByMarketplace: {
      /** @description Amazon Standard Identification Number (ASIN) of the listings item. */
      asin?: string;
      /**
       * @description Identifies the condition of the listings item.
       * @enum {string}
       */
      conditionType?:
        | 'new_new'
        | 'new_open_box'
        | 'new_oem'
        | 'refurbished_refurbished'
        | 'used_like_new'
        | 'used_very_good'
        | 'used_good'
        | 'used_acceptable'
        | 'collectible_like_new'
        | 'collectible_very_good'
        | 'collectible_good'
        | 'collectible_acceptable'
        | 'club_club';
      /**
       * Format: date-time
       * @description The date the listings item was created in ISO 8601 format.
       */
      createdDate: string;
      /** @description The fulfillment network stock keeping unit is an identifier used by Amazon fulfillment centers to identify each unique item. */
      fnSku?: string;
      /** @description The name or title associated with an Amazon catalog item. */
      itemName?: string;
      /**
       * Format: date-time
       * @description The date the listings item was last updated in ISO 8601 format.
       */
      lastUpdatedDate: string;
      mainImage?: components['schemas']['ItemImage'];
      /** @description A marketplace identifier. Identifies the Amazon marketplace for the listings item. */
      marketplaceId: string;
      /** @description The Amazon product type of the listings item. */
      productType: string;
      /** @description Statuses that apply to the listings item. */
      status: ('BUYABLE' | 'DISCOVERABLE')[];
    };
    /** @description A variation theme that indicates the combination of listing item attributes that define the variation family. */
    ItemVariationTheme: {
      /** @description The names of the listing item attributes that are associated with the variation theme. */
      attributes: string[];
      /**
       * @description The variation theme that indicates the combination of listing item attributes that define the variation family.
       * @example COLOR_NAME/STYLE_NAME
       */
      theme: string;
    };
    /** @description The request body schema for the `patchListingsItem` operation. */
    ListingsItemPatchRequest: {
      /** @description One or more JSON Patch operations to perform on the listings item. */
      patches: [
        components['schemas']['PatchOperation'],
        ...components['schemas']['PatchOperation'][]
      ];
      /** @description The Amazon product type of the listings item. */
      productType: string;
    };
    /** @description The request body schema for the `putListingsItem` operation. */
    ListingsItemPutRequest: {
      /** @description A JSON object containing structured listings item attribute data keyed by attribute name. */
      attributes: {
        [key: string]: unknown;
      };
      /** @description The Amazon product type of the listings item. */
      productType: string;
      /**
       * @description The name of the requirements set for the provided data.
       * @enum {string}
       */
      requirements?: 'LISTING' | 'LISTING_PRODUCT_ONLY' | 'LISTING_OFFER_ONLY';
    };
    /** @description Response containing the results of a submission to the Selling Partner API for Listings Items. */
    ListingsItemSubmissionResponse: {
      identifiers?: components['schemas']['ItemIdentifiers'];
      /** @description Listings item issues related to the listings item submission. */
      issues?: components['schemas']['Issue'][];
      /** @description A selling partner provided identifier for an Amazon listing. */
      sku: string;
      /**
       * @description The status of the listings item submission.
       * @enum {string}
       */
      status: 'ACCEPTED' | 'INVALID' | 'VALID';
      /** @description The unique identifier of the listings item submission. */
      submissionId: string;
    };
    /** @description The currency type and amount. */
    Money: {
      amount: components['schemas']['Decimal'];
      /** @description Three-digit currency code in ISO 4217 format. */
      currencyCode: string;
    };
    /** @description When a request produces a response that exceeds the `pageSize`, pagination occurs. This means the response is divided into individual pages. To retrieve the next page or the previous page, you must pass the `nextToken` value or the `previousToken` value as the `pageToken` parameter in the next request. When you receive the last page, there is no `nextToken` key in the pagination object. */
    Pagination: {
      /** @description A token that can be used to fetch the next page. */
      nextToken?: string;
      /** @description A token that can be used to fetch the previous page. */
      previousToken?: string;
    };
    /** @description Individual JSON Patch operation for an HTTP PATCH request. */
    PatchOperation: {
      /**
       * @description Type of JSON Patch operation. Supported JSON Patch operations include `add`, `replace`, `merge` and `delete`. Refer to <https://tools.ietf.org/html/rfc6902>.
       * @enum {string}
       */
      op: 'add' | 'replace' | 'merge' | 'delete';
      /** @description JSON Pointer path of the element to patch. Refer to [JavaScript Object Notation (JSON) Patch](https://tools.ietf.org/html/rfc6902) for more information. */
      path: string;
      /** @description JSON value to `add`, `replace`, `merge` or `delete`. */
      value?: {
        [key: string]: unknown;
      }[];
    };
    /** @description The number of Amazon Points offered with the purchase of an item, and their monetary value. Note that the `Points` element is only returned in Japan (JP). */
    Points: {
      pointsNumber: number;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  searchListingsItems: {
    parameters: {
      query: {
        /**
         * @description A date-time that is used to filter listing items. The response includes listings items that were created at or after this time. Values are in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         * @example 2024-03-01T01:30:00.000Z
         */
        createdAfter?: string;
        /**
         * @description A date-time that is used to filter listing items. The response includes listings items that were created at or before this time. Values are in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         * @example 2024-03-31T21:45:00.000Z
         */
        createdBefore?: string;
        /**
         * @description A comma-delimited list of product identifiers that you can use to search for listings items.
         *
         *     **Note**:
         *     1. This is required when you specify `identifiersType`.
         *     2. You cannot use 'identifiers' if you specify `variationParentSku` or `packageHierarchySku`.
         * @example GM-ZDPI-9B4E
         */
        identifiers?: string[];
        /**
         * @description A type of product identifiers that you can use to search for listings items.
         *
         *     **Note**:
         *     This is required when `identifiers` is provided.
         * @example SKU
         */
        identifiersType?:
          | 'ASIN'
          | 'EAN'
          | 'FNSKU'
          | 'GTIN'
          | 'ISBN'
          | 'JAN'
          | 'MINSAN'
          | 'SKU'
          | 'UPC';
        /**
         * @description A comma-delimited list of datasets that you want to include in the response. Default: `summaries`.
         * @example summaries
         */
        includedData?: (
          | 'summaries'
          | 'attributes'
          | 'issues'
          | 'offers'
          | 'fulfillmentAvailability'
          | 'procurement'
          | 'relationships'
          | 'productTypes'
        )[];
        /**
         * @description A locale that is used to localize issues. When not provided, the default language code of the first marketplace is used. Examples: "en_US", "fr_CA", "fr_FR". When a localization is not available in the specified locale, localized messages default to "en_US".
         * @example en_US
         */
        issueLocale?: string;
        /**
         * @description A date-time that is used to filter listing items. The response includes listings items that were last updated at or after this time. Values are in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         * @example 2024-05-05T23:45:00.000Z
         */
        lastUpdatedAfter?: string;
        /**
         * @description A date-time that is used to filter listing items. The response includes listings items that were last updated at or before this time. Values are in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date-time format.
         * @example 2024-05-01T01:15:00.000Z
         */
        lastUpdatedBefore?: string;
        /**
         * @description A comma-delimited list of Amazon marketplace identifiers for the request.
         * @example ATVPDKIKX0DER
         */
        marketplaceIds: [] | [string];
        /**
         * @description Filter results to include listing items that contain or are contained by the specified SKU.
         *
         *     **Note**: You cannot use `packageHierarchySku` if you include `identifiers` or `variationParentSku` in your request.
         * @example GM-ZDPI-9B4E
         */
        packageHierarchySku?: string;
        /**
         * @description The number of results that you want to include on each page.
         * @example 9
         */
        pageSize?: number;
        /**
         * @description A token that you can use to fetch a specific page when there are multiple pages of results.
         * @example sdlkj234lkj234lksjdflkjwdflkjsfdlkj234234234234
         */
        pageToken?: string;
        /**
         * @description An attribute by which to sort the returned listing items.
         * @example lastUpdatedDate
         */
        sortBy?: 'sku' | 'createdDate' | 'lastUpdatedDate';
        /**
         * @description The order in which to sort the result items.
         * @example DESC
         */
        sortOrder?: 'ASC' | 'DESC';
        /**
         * @description Filters results to include listing items that are variation children of the specified SKU.
         *
         *     **Note**: You cannot use `variationParentSku` if you include `identifiers` or `packageHierarchySku` in your request.
         * @example GM-ZDPI-9B4E
         */
        variationParentSku?: string;
        /**
         * @description Filter results to include only listing items that have issues that match one or more of the specified severity levels.
         * @example WARNING
         */
        withIssueSeverity?: ('WARNING' | 'ERROR')[];
        /**
         * @description Filter results to include only listing items that don't contain the specified statuses.
         * @example BUYABLE
         */
        withoutStatus?: ('BUYABLE' | 'DISCOVERABLE')[];
        /**
         * @description Filter results to include only listing items that have the specified status.
         * @example DISCOVERABLE
         */
        withStatus?: ('BUYABLE' | 'DISCOVERABLE')[];
      };
      header?: never;
      path: {
        /** @description A selling partner identifier, such as a merchant account or vendor code. */
        sellerId: string;
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
          'application/json': components['schemas']['ItemSearchResults'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request size exceeded the maximum accepted size. */
      413: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request payload is in an unsupported format. */
      415: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
    };
  };
  getListingsItem: {
    parameters: {
      query: {
        /**
         * @description A comma-delimited list of data sets to include in the response. Default: `summaries`.
         * @example summaries
         */
        includedData?: (
          | 'summaries'
          | 'attributes'
          | 'issues'
          | 'offers'
          | 'fulfillmentAvailability'
          | 'procurement'
          | 'relationships'
          | 'productTypes'
        )[];
        /**
         * @description A locale for localization of issues. When not provided, the default language code of the first marketplace is used. Examples: `en_US`, `fr_CA`, `fr_FR`. Localized messages default to `en_US` when a localization is not available in the specified locale.
         * @example en_US
         */
        issueLocale?: string;
        /**
         * @description A comma-delimited list of Amazon marketplace identifiers for the request.
         * @example ATVPDKIKX0DER
         */
        marketplaceIds: [] | [string];
      };
      header?: never;
      path: {
        /** @description A selling partner identifier, such as a merchant account or vendor code. */
        sellerId: string;
        /** @description A selling partner provided identifier for an Amazon listing. */
        sku: string;
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
          'application/json': components['schemas']['Item'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request size exceeded the maximum accepted size. */
      413: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request payload is in an unsupported format. */
      415: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
    };
  };
  putListingsItem: {
    parameters: {
      query: {
        /**
         * @description A comma-delimited list of data sets to include in the response. Default: `issues`.
         * @example issues
         */
        includedData?: ('identifiers' | 'issues')[];
        /**
         * @description A locale for localization of issues. When not provided, the default language code of the first marketplace is used. Examples: `en_US`, `fr_CA`, `fr_FR`. Localized messages default to `en_US` when a localization is not available in the specified locale.
         * @example en_US
         */
        issueLocale?: string;
        /**
         * @description A comma-delimited list of Amazon marketplace identifiers for the request.
         * @example ATVPDKIKX0DER
         */
        marketplaceIds: [] | [string];
        /**
         * @description The mode of operation for the request.
         * @example VALIDATION_PREVIEW
         */
        mode?: 'VALIDATION_PREVIEW';
      };
      header?: never;
      path: {
        /** @description A selling partner identifier, such as a merchant account or vendor code. */
        sellerId: string;
        /** @description A selling partner provided identifier for an Amazon listing. */
        sku: string;
      };
      cookie?: never;
    };
    /** @description The request body schema for the `putListingsItem` operation. */
    requestBody: {
      content: {
        'application/json': components['schemas']['ListingsItemPutRequest'];
      };
    };
    responses: {
      /** @description Successfully understood the request to create or fully-update a listings item. See the response to determine if the submission has been accepted. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListingsItemSubmissionResponse'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request size exceeded the maximum accepted size. */
      413: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request payload is in an unsupported format. */
      415: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
    };
  };
  deleteListingsItem: {
    parameters: {
      query: {
        /**
         * @description A locale for localization of issues. When not provided, the default language code of the first marketplace is used. Examples: `en_US`, `fr_CA`, `fr_FR`. Localized messages default to `en_US` when a localization is not available in the specified locale.
         * @example en_US
         */
        issueLocale?: string;
        /**
         * @description A comma-delimited list of Amazon marketplace identifiers for the request.
         * @example ATVPDKIKX0DER
         */
        marketplaceIds: [] | [string];
      };
      header?: never;
      path: {
        /** @description A selling partner identifier, such as a merchant account or vendor code. */
        sellerId: string;
        /** @description A selling partner provided identifier for an Amazon listing. */
        sku: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successfully understood the listings item delete request. See the response to determine whether the submission has been accepted. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListingsItemSubmissionResponse'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request size exceeded the maximum accepted size. */
      413: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request payload is in an unsupported format. */
      415: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
    };
  };
  patchListingsItem: {
    parameters: {
      query: {
        /**
         * @description A comma-delimited list of data sets to include in the response. Default: `issues`.
         * @example issues
         */
        includedData?: ('identifiers' | 'issues')[];
        /**
         * @description A locale for localization of issues. When not provided, the default language code of the first marketplace is used. Examples: `en_US`, `fr_CA`, `fr_FR`. Localized messages default to `en_US` when a localization is not available in the specified locale.
         * @example en_US
         */
        issueLocale?: string;
        /**
         * @description A comma-delimited list of Amazon marketplace identifiers for the request.
         * @example ATVPDKIKX0DER
         */
        marketplaceIds: string[];
        /**
         * @description The mode of operation for the request.
         * @example VALIDATION_PREVIEW
         */
        mode?: 'VALIDATION_PREVIEW';
      };
      header?: never;
      path: {
        /** @description A selling partner identifier, such as a merchant account or vendor code. */
        sellerId: string;
        /** @description A selling partner provided identifier for an Amazon listing. */
        sku: string;
      };
      cookie?: never;
    };
    /** @description The request body schema for the `patchListingsItem` operation. */
    requestBody: {
      content: {
        'application/json': components['schemas']['ListingsItemPatchRequest'];
      };
    };
    responses: {
      /** @description Successfully understood the listings item patch request. See the response to determine if the submission was accepted. */
      200: {
        headers: {
          /** @description Your rate limit (requests per second) for this operation. */
          'x-amzn-RateLimit-Limit'?: string;
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ListingsItemSubmissionResponse'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request size exceeded the maximum accepted size. */
      413: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
        };
      };
      /** @description The request payload is in an unsupported format. */
      415: {
        headers: {
          /** @description Unique request reference identifier. */
          'x-amzn-RequestId'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
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
          'application/json': components['schemas']['ErrorList'];
        };
      };
    };
  };
}
