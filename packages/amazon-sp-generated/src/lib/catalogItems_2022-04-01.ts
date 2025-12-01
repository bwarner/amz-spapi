export type paths = {
    "/catalog/2022-04-01/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Search for a list of Amazon catalog items and item-related information. You can search by identifier or by keywords.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 2 | 2 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["searchCatalogItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/2022-04-01/items/{asin}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Retrieves details for an item in the Amazon catalog.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 2 | 2 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getCatalogItem"];
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
        /** @description A brand that you can use to refine your search. */
        BrandRefinement: {
            /** @description The brand name that you can use to refine your search. */
            brandName: string;
            /** @description The estimated number of results that would be returned if you refine your search by the specified `brandName`. */
            numberOfResults: number;
        };
        /** @description A classification that you can use to refine your search. */
        ClassificationRefinement: {
            /** @description The identifier of the classification that you can use to refine your search. */
            classificationId: string;
            /** @description Display name for the classification. */
            displayName: string;
            /** @description The estimated number of results that would be returned if you refine your search by the specified `classificationId`. */
            numberOfResults: number;
        };
        /** @description The value of an individual dimension for an Amazon catalog item or item package. */
        Dimension: {
            /** @description Unit of measurement for the dimension value. */
            unit?: string;
            /** @description Numeric value of the dimension. */
            value?: number;
        };
        /** @description Dimensions of an Amazon catalog item or item in its packaging. */
        Dimensions: {
            height?: components["schemas"]["Dimension"];
            length?: components["schemas"]["Dimension"];
            weight?: components["schemas"]["Dimension"];
            width?: components["schemas"]["Dimension"];
        };
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
            /** @description A list of error responses returned when a request is unsuccessful. */
            errors: components["schemas"]["Error"][];
        };
        /** @description An item in the Amazon catalog. */
        Item: {
            asin: components["schemas"]["ItemAsin"];
            attributes?: components["schemas"]["ItemAttributes"];
            classifications?: components["schemas"]["ItemBrowseClassifications"];
            dimensions?: components["schemas"]["ItemDimensions"];
            identifiers?: components["schemas"]["ItemIdentifiers"];
            images?: components["schemas"]["ItemImages"];
            productTypes?: components["schemas"]["ItemProductTypes"];
            relationships?: components["schemas"]["ItemRelationships"];
            salesRanks?: components["schemas"]["ItemSalesRanks"];
            summaries?: components["schemas"]["ItemSummaries"];
            vendorDetails?: components["schemas"]["ItemVendorDetails"];
        };
        /** @description The unique identifier of an item in the Amazon catalog. */
        ItemAsin: string;
        /** @description A JSON object containing structured item attribute data that is keyed by attribute name. Catalog item attributes conform to the related Amazon product type definitions that you can get from the [Product Type Definitions API](https://developer-docs.amazon.com/sp-api/reference/product-type-definitions-v2020-09-01). */
        ItemAttributes: {
            [key: string]: unknown;
        };
        /** @description Classification (browse node) for an Amazon catalog item. */
        ItemBrowseClassification: {
            /** @description Identifier of the classification. */
            classificationId: string;
            /** @description Display name for the classification. */
            displayName: string;
            parent?: components["schemas"]["ItemBrowseClassification"];
        };
        /** @description An array of classifications (browse nodes) that is associated with the item in the Amazon catalog, grouped by `marketplaceId`. */
        ItemBrowseClassifications: components["schemas"]["ItemBrowseClassificationsByMarketplace"][];
        /** @description Classifications (browse nodes) that are associated with the item in the Amazon catalog for the indicated `marketplaceId`. */
        ItemBrowseClassificationsByMarketplace: {
            /** @description Classifications (browse nodes) that are associated with the item in the Amazon catalog. */
            classifications?: components["schemas"]["ItemBrowseClassification"][];
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
        };
        /** @description Sales rank of an Amazon catalog item. */
        ItemClassificationSalesRank: {
            /** @description Identifier of the classification that is associated with the sales rank. */
            classificationId: string;
            /** @description Corresponding Amazon retail website URL for the sales category. */
            link?: string;
            /** @description Sales rank. */
            rank: number;
            /** @description Name of the sales rank. */
            title: string;
        };
        /** @description Individual contributor to the creation of an item, such as an author or actor. */
        ItemContributor: {
            role: components["schemas"]["ItemContributorRole"];
            /** @description Name of the contributor, such as `Jane Austen`. */
            value: string;
        };
        /** @description Role of an individual contributor in the creation of an item, such as author or actor. */
        ItemContributorRole: {
            /** @description Display name of the role in the requested locale, such as `Author` or `Actor`. */
            displayName?: string;
            /** @description Role value for the Amazon catalog item, such as `author` or `actor`. */
            value: string;
        };
        /** @description An array of dimensions that are associated with the item in the Amazon catalog, grouped by `marketplaceId`. */
        ItemDimensions: components["schemas"]["ItemDimensionsByMarketplace"][];
        /** @description Dimensions that are associated with the item in the Amazon catalog for the indicated `marketplaceId`. */
        ItemDimensionsByMarketplace: {
            item?: components["schemas"]["Dimensions"];
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
            package?: components["schemas"]["Dimensions"];
        };
        /** @description Sales rank of an Amazon catalog item, grouped by website display group. */
        ItemDisplayGroupSalesRank: {
            /** @description Corresponding Amazon retail website URL for the sales rank. */
            link?: string;
            /** @description Sales rank. */
            rank: number;
            /** @description Name of the sales rank. */
            title: string;
            /** @description Name of the website display group that is associated with the sales rank */
            websiteDisplayGroup: string;
        };
        /** @description The identifier that is associated with the item in the Amazon catalog, such as a UPC or EAN identifier. */
        ItemIdentifier: {
            /** @description Identifier of the item. */
            identifier: string;
            /** @description Type of identifier, such as UPC, EAN, or ISBN. */
            identifierType: string;
        };
        /** @description Identifiers associated with the item in the Amazon catalog, such as UPC and EAN identifiers. */
        ItemIdentifiers: components["schemas"]["ItemIdentifiersByMarketplace"][];
        /** @description Identifiers that are associated with the item in the Amazon catalog, grouped by `marketplaceId`. */
        ItemIdentifiersByMarketplace: {
            /** @description Identifiers associated with the item in the Amazon catalog for the indicated `marketplaceId`. */
            identifiers: components["schemas"]["ItemIdentifier"][];
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids).identifier. */
            marketplaceId: string;
        };
        /** @description Image for an item in the Amazon catalog. */
        ItemImage: {
            /** @description Height of the image in pixels. */
            height: number;
            /** @description URL for the image. */
            link: string;
            /**
             * @description Variant of the image, such as `MAIN` or `PT01`.
             * @example MAIN
             * @enum {string}
             */
            variant: "MAIN" | "PT01" | "PT02" | "PT03" | "PT04" | "PT05" | "PT06" | "PT07" | "PT08" | "SWCH";
            /** @description Width of the image in pixels. */
            width: number;
        };
        /** @description The images for an item in the Amazon catalog. */
        ItemImages: components["schemas"]["ItemImagesByMarketplace"][];
        /** @description Images for an item in the Amazon catalog, grouped by `marketplaceId`. */
        ItemImagesByMarketplace: {
            /** @description Images for an item in the Amazon catalog, grouped by `marketplaceId`. */
            images: components["schemas"]["ItemImage"][];
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
        };
        /** @description Product type that is associated with the Amazon catalog item, grouped by `marketplaceId`. */
        ItemProductTypeByMarketplace: {
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId?: string;
            /**
             * @description Name of the product type that is associated with the Amazon catalog item.
             * @example LUGGAGE
             */
            productType?: string;
        };
        /** @description Product types that are associated with the Amazon catalog item. */
        ItemProductTypes: components["schemas"]["ItemProductTypeByMarketplace"][];
        /** @description Relationship details for an Amazon catalog item. */
        ItemRelationship: {
            /** @description ASINs of the related items that are children of this item. */
            childAsins?: string[];
            /** @description ASINs of the related items that are parents of this item. */
            parentAsins?: string[];
            /**
             * @description Type of relationship.
             * @example VARIATION
             * @enum {string}
             */
            type: "VARIATION" | "PACKAGE_HIERARCHY";
            variationTheme?: components["schemas"]["ItemVariationTheme"];
        };
        /** @description Relationships grouped by `marketplaceId` for an Amazon catalog item (for example, variations). */
        ItemRelationships: components["schemas"]["ItemRelationshipsByMarketplace"][];
        /** @description Relationship details for the Amazon catalog item for the specified Amazon `marketplaceId`. */
        ItemRelationshipsByMarketplace: {
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
            /** @description Relationships for the item. */
            relationships: components["schemas"]["ItemRelationship"][];
        };
        /** @description Sales ranks of an Amazon catalog item. */
        ItemSalesRanks: components["schemas"]["ItemSalesRanksByMarketplace"][];
        /** @description Sales ranks of an Amazon catalog item, grouped by `marketplaceId`. */
        ItemSalesRanksByMarketplace: {
            /** @description Sales ranks of an Amazon catalog item for a `marketplaceId`, grouped by classification. */
            classificationRanks?: components["schemas"]["ItemClassificationSalesRank"][];
            /** @description Sales ranks of an Amazon catalog item for a `marketplaceId`, grouped by website display group. */
            displayGroupRanks?: components["schemas"]["ItemDisplayGroupSalesRank"][];
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
        };
        /** @description Items in the Amazon catalog and search-related metadata. */
        ItemSearchResults: {
            /** @description A list of items from the Amazon catalog. */
            items: components["schemas"]["Item"][];
            /** @description For searches that are based on `identifiers`, `numberOfResults` is the total number of Amazon catalog items found. For searches that are based on `keywords`, `numberOfResults` is the estimated total number of Amazon catalog items that are matched by the search query. Only results up to the page count limit are returned per request regardless of the number found.
             *
             *     **Note:** The maximum number of items (ASINs) that can be returned and paged through is 1,000. */
            numberOfResults: number;
            pagination?: components["schemas"]["Pagination"];
            refinements?: components["schemas"]["Refinements"];
        };
        /** @description Summaries of Amazon catalog items. */
        ItemSummaries: components["schemas"]["ItemSummaryByMarketplace"][];
        /** @description Information about an Amazon catalog item for the indicated `marketplaceId`. */
        ItemSummaryByMarketplace: {
            /** @description When `true`, the Amazon catalog item is intended for an adult audience or is sexual in nature. */
            adultProduct?: boolean;
            /** @description When `true`, the Amazon catalog item is autographed. */
            autographed?: boolean;
            /** @description Name of the brand that is associated with the Amazon catalog item. */
            brand?: string;
            browseClassification?: components["schemas"]["ItemBrowseClassification"];
            /** @description The color that is associated with the Amazon catalog item. */
            color?: string;
            /** @description Individual contributors to the creation of the item, such as the authors or actors. */
            contributors?: components["schemas"]["ItemContributor"][];
            /**
             * @description Classification type that is associated with the Amazon catalog item.
             * @enum {string}
             */
            itemClassification?: "BASE_PRODUCT" | "OTHER" | "PRODUCT_BUNDLE" | "VARIATION_PARENT";
            /** @description The name that is associated with the Amazon catalog item. */
            itemName?: string;
            /** @description The name of the manufacturer that is associated with the Amazon catalog item. */
            manufacturer?: string;
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
            /** @description When true, the item is classified as memorabilia. */
            memorabilia?: boolean;
            /** @description The model number that is associated with the Amazon catalog item. */
            modelNumber?: string;
            /** @description The quantity of the Amazon catalog item within one package. */
            packageQuantity?: number;
            /** @description The part number that is associated with the Amazon catalog item. */
            partNumber?: string;
            /**
             * Format: date
             * @description The earliest date on which the Amazon catalog item can be shipped to customers.
             */
            releaseDate?: string;
            /** @description The name of the size of the Amazon catalog item. */
            size?: string;
            /** @description The name of the style that is associated with the Amazon catalog item. */
            style?: string;
            /** @description When true, the Amazon catalog item is eligible for trade-in. */
            tradeInEligible?: boolean;
            /** @description The identifier of the website display group that is associated with the Amazon catalog item. */
            websiteDisplayGroup?: string;
            /** @description The display name of the website display group that is associated with the Amazon catalog item. */
            websiteDisplayGroupName?: string;
        };
        /** @description The variation theme is a list of Amazon catalog item attributes that define the variation family. */
        ItemVariationTheme: {
            /** @description Names of the Amazon catalog item attributes that are associated with the variation theme. */
            attributes?: string[];
            /**
             * @description Variation theme that indicates the combination of Amazon catalog item attributes that define the variation family.
             * @example COLOR_NAME/STYLE_NAME
             */
            theme?: string;
        };
        /** @description The vendor details that are associated with an Amazon catalog item. Vendor details are only available to vendors. */
        ItemVendorDetails: components["schemas"]["ItemVendorDetailsByMarketplace"][];
        /** @description The vendor details that are associated with an Amazon catalog item for the specified `marketplaceId`. */
        ItemVendorDetailsByMarketplace: {
            /** @description The brand code that is associated with an Amazon catalog item. */
            brandCode?: string;
            /** @description The manufacturer code that is associated with an Amazon catalog item. */
            manufacturerCode?: string;
            /** @description The parent vendor code of the manufacturer code. */
            manufacturerCodeParent?: string;
            /** @description Amazon marketplace identifier. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids). */
            marketplaceId: string;
            productCategory?: components["schemas"]["ItemVendorDetailsCategory"];
            /** @description The product group that is associated with an Amazon catalog item. */
            productGroup?: string;
            productSubcategory?: components["schemas"]["ItemVendorDetailsCategory"];
            /**
             * @description The replenishment category that is associated with an Amazon catalog item.
             * @enum {string}
             */
            replenishmentCategory?: "ALLOCATED" | "BASIC_REPLENISHMENT" | "IN_SEASON" | "LIMITED_REPLENISHMENT" | "MANUFACTURER_OUT_OF_STOCK" | "NEW_PRODUCT" | "NON_REPLENISHABLE" | "NON_STOCKUPABLE" | "OBSOLETE" | "PLANNED_REPLENISHMENT";
        };
        /** @description The product category or subcategory that is associated with an Amazon catalog item. */
        ItemVendorDetailsCategory: {
            /** @description The display name of the product category or subcategory. */
            displayName?: string;
            /** @description The code that identifies the product category or subcategory. */
            value?: string;
        };
        /** @description Pagination occurs when a request produces a response that exceeds the `pageSize`. This means that the response is divided into individual pages. To retrieve the next page or the previous page of results, you must pass the `nextToken` value or the `previousToken` value as the `pageToken` parameter in the next request. There is no `nextToken` in the pagination object on the last page. */
        Pagination: {
            /** @description A token that you can use to retrieve the next page. */
            nextToken?: string;
            /** @description A token that you can use to retrieve the previous page. */
            previousToken?: string;
        };
        /** @description Optional fields that you can use to refine your search results. */
        Refinements: {
            /** @description A list of brands you can use to refine your search. */
            brands: components["schemas"]["BrandRefinement"][];
            /** @description A list of classifications you can use to refine your search. */
            classifications: components["schemas"]["ClassificationRefinement"][];
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
    searchCatalogItems: {
        parameters: {
            query: {
                /**
                 * @description A comma-delimited list of brand names that you can use to limit the search in queries based on `keywords`. **Note:** Cannot be used with `identifiers`.
                 * @example Beautiful Boats
                 */
                brandNames?: string[];
                /**
                 * @description A comma-delimited list of classification identifiers that you can use to limit the search in queries based on `keywords`. **Note:** Cannot be used with `identifiers`.
                 * @example 12345678
                 */
                classificationIds?: string[];
                /**
                 * @description A comma-delimited list of product identifiers that you can use to search the Amazon catalog. **Note:** You cannot include `identifiers` and `keywords` in the same request.
                 * @example shoes
                 */
                identifiers?: string[];
                /**
                 * @description The type of product identifiers that you can use to search the Amazon catalog. **Note:** `identifiersType` is required when `identifiers` is in the request.
                 * @example ASIN
                 */
                identifiersType?: "ASIN" | "EAN" | "GTIN" | "ISBN" | "JAN" | "MINSAN" | "SKU" | "UPC";
                /**
                 * @description A comma-delimited list of datasets to include in the response.
                 * @example summaries
                 */
                includedData?: ("attributes" | "classifications" | "dimensions" | "identifiers" | "images" | "productTypes" | "relationships" | "salesRanks" | "summaries" | "vendorDetails")[];
                /**
                 * @description A comma-delimited list of keywords that you can use to search the Amazon catalog. **Note:** You cannot include `keywords` and `identifiers` in the same request.
                 * @example shoes
                 */
                keywords?: string[];
                /**
                 * @description The language of the keywords that are included in queries based on `keywords`. Defaults to the primary locale of the marketplace. **Note:** Cannot be used with `identifiers`.
                 * @example en_US
                 */
                keywordsLocale?: string;
                /**
                 * @description The locale for which you want to retrieve localized summaries. Defaults to the primary locale of the marketplace.
                 * @example en_US
                 */
                locale?: string;
                /**
                 * @description A comma-delimited list of Amazon marketplace identifiers. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids).
                 * @example ATVPDKIKX0DER
                 */
                marketplaceIds: [
                ] | [
                    string
                ];
                /**
                 * @description The number of results to include on each page.
                 * @example 9
                 */
                pageSize?: number;
                /**
                 * @description A token that you can use to fetch a specific page when there are multiple pages of results.
                 * @example sdlkj234lkj234lksjdflkjwdflkjsfdlkj234234234234
                 */
                pageToken?: string;
                /** @description A selling partner identifier, such as a seller account or vendor code. **Note:** Required when `identifiersType` is `SKU`. */
                sellerId?: string;
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
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ItemSearchResults"];
                };
            };
            /** @description Request has missing or invalid parameters and cannot be parsed. */
            400: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The resource specified does not exist. */
            404: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The request size exceeded the maximum accepted size. */
            413: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The request payload is in an unsupported format. */
            415: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The frequency of requests was greater than allowed. */
            429: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
            500: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description Temporary overloading or maintenance of the server. */
            503: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
        };
    };
    getCatalogItem: {
        parameters: {
            query: {
                /**
                 * @description A comma-delimited list of datasets to include in the response.
                 * @example summaries
                 */
                includedData?: ("attributes" | "classifications" | "dimensions" | "identifiers" | "images" | "productTypes" | "relationships" | "salesRanks" | "summaries" | "vendorDetails")[];
                /**
                 * @description The locale for which you want to retrieve localized summaries. Defaults to the primary locale of the marketplace.
                 * @example en_US
                 */
                locale?: string;
                /**
                 * @description A comma-delimited list of Amazon marketplace identifiers. To find the ID for your marketplace, refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids).
                 * @example ATVPDKIKX0DER
                 */
                marketplaceIds: string[];
            };
            header?: never;
            path: {
                /** @description The Amazon Standard Identification Number (ASIN) of the item. */
                asin: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success. */
            200: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Item"];
                };
            };
            /** @description Request has missing or invalid parameters and cannot be parsed. */
            400: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description Indicates that access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The resource specified does not exist. */
            404: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The request size exceeded the maximum accepted size. */
            413: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The request payload is in an unsupported format. */
            415: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description The frequency of requests was greater than allowed. */
            429: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description An unexpected condition occurred that prevented the server from fulfilling the request. */
            500: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
            /** @description Temporary overloading or maintenance of the server. */
            503: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorList"];
                };
            };
        };
    };
}
