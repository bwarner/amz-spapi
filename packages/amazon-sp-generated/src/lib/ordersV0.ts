export type paths = {
    "/orders/v0/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns orders that are created or updated during the specified time period. If you want to return specific types of orders, you can apply filters to your request. `NextToken` doesn't affect any filters that you include in your request; it only impacts the pagination for the filtered orders response.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.0167 | 20 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns the order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/address": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns the shipping address for the order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrderAddress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/buyerInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns buyer information for the order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrderBuyerInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/orderItems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns detailed order item information for the order that you specify. If `NextToken` is provided, it's used to retrieve the next page of order items.
         *
         *     __Note__: When an order is in the Pending state (the order has been placed but payment has not been authorized), the getOrderItems operation does not return information about pricing, taxes, shipping charges, gift status or promotions for the order items in the order. After an order leaves the Pending state (this occurs when payment has been authorized) and enters the Unshipped, Partially Shipped, or Shipped state, the getOrderItems operation returns information about pricing, taxes, shipping charges, gift status and promotions for the order items in the order.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrderItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/orderItems/buyerInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns buyer information for the order items in the order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrderItemsBuyerInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/regulatedInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns regulated information for the order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        get: operations["getOrderRegulatedInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** @description Updates (approves or rejects) the verification status of an order containing regulated products.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 0.5 | 30 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        patch: operations["updateVerificationStatus"];
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/shipment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Update the shipment status for an order that you specify.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 5 | 15 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        post: operations["updateShipmentStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/v0/orders/{orderId}/shipmentConfirmation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Updates the shipment confirmation status for a specified order.
         *
         *     **Usage Plan:**
         *
         *     | Rate (requests per second) | Burst |
         *     | ---- | ---- |
         *     | 2 | 10 |
         *
         *     The `x-amzn-RateLimit-Limit` response header contains the usage plan rate limits for the operation, when available. The preceding table contains the default rate and burst values for this operation. Selling partners whose business demands require higher throughput might have higher rate and burst values than those shown here. For more information, refer to [Usage Plans and Rate Limits](https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits-in-the-sp-api). */
        post: operations["confirmShipment"];
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
        /** @description The shipping address for the order. */
        Address: {
            /** @description The street address. */
            AddressLine1?: string;
            /** @description Additional street address information, if required. */
            AddressLine2?: string;
            /** @description Additional street address information, if required. */
            AddressLine3?: string;
            /**
             * @description The address type of the shipping address.
             * @enum {string}
             */
            AddressType?: "Residential" | "Commercial";
            /** @description The city. */
            City?: string;
            /** @description The company name of the recipient.
             *
             *     **Note**: This attribute is only available for shipping address. */
            CompanyName?: string;
            /** @description The country code. A two-character country code, in ISO 3166-1 alpha-2 format. */
            CountryCode?: string;
            /** @description The county. */
            County?: string;
            /** @description The district. */
            District?: string;
            ExtendedFields?: components["schemas"]["AddressExtendedFields"];
            /** @description The municipality. */
            Municipality?: string;
            /** @description The name. */
            Name?: string;
            /** @description The phone number of the buyer.
             *
             *     **Note**:
             *     1. This attribute is only available for shipping address.
             *     2. In some cases, the buyer phone number is suppressed:
             *     a. Phone is suppressed for all `AFN` (fulfilled by Amazon) orders.
             *     b. Phone is suppressed for the shipped `MFN` (fulfilled by seller) order when the current date is past the Latest Delivery Date. */
            Phone?: string;
            /** @description The postal code. */
            PostalCode?: string;
            /** @description The state or region. */
            StateOrRegion?: string;
        };
        /** @description The container for address extended fields (such as `street name` and `street number`). Currently only available with Brazil shipping addresses. */
        AddressExtendedFields: {
            /** @description The floor number/unit number in the building/private house number. */
            Complement?: string;
            /** @description The neighborhood. This value is only used in some countries (such as Brazil). */
            Neighborhood?: string;
            /** @description The street name. */
            StreetName?: string;
            /** @description The house, building, or property number associated with the location's street address. */
            StreetNumber?: string;
        };
        /** @description Contains the list of programs that Amazon associates with an item.
         *
         *     Possible programs are:
         *      - **Subscribe and Save**: Offers recurring, scheduled deliveries to Amazon customers and Amazon Business customers for their frequently ordered products. - **FBM Ship+**: Unlocks expedited shipping without the extra cost. Helps you to provide accurate and fast delivery dates to Amazon customers. You also receive protection from late deliveries, a discount on expedited shipping rates, and cash back when you ship. */
        AmazonPrograms: {
            /** @description A list of the programs that Amazon associates with the order item.
             *
             *     **Possible values**: `SUBSCRIBE_AND_SAVE`, `FBM_SHIP_PLUS` */
            Programs: string[];
        };
        /** @description An item that is associated with an order item. For example, a tire installation service that is purchased with tires. */
        AssociatedItem: {
            AssociationType?: components["schemas"]["AssociationType"];
            /** @description The order item's order identifier, in 3-7-7 format. */
            OrderId?: string;
            /** @description An Amazon-defined item identifier for the associated item. */
            OrderItemId?: string;
        };
        /**
         * @description The type of association an item has with an order item.
         * @enum {string}
         */
        AssociationType: "VALUE_ADD_SERVICE";
        /** @description Contains information regarding the Shipping Settings Automation program, such as whether the order's shipping settings were generated automatically, and what those settings are. */
        AutomatedShippingSettings: {
            /** @description Auto-generated carrier for SSA orders. */
            AutomatedCarrier?: string;
            /** @description Auto-generated ship method for SSA orders. */
            AutomatedShipMethod?: string;
            /** @description When true, this order has automated shipping settings generated by Amazon. This order could be identified as an SSA order. */
            HasAutomatedShippingSettings?: boolean;
        };
        /** @description Business days and hours when the destination is open for deliveries. */
        BusinessHours: {
            /**
             * @description Day of the week.
             * @enum {string}
             */
            DayOfWeek?: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
            /** @description Time window during the day when the business is open. */
            OpenIntervals?: components["schemas"]["OpenInterval"][];
        };
        /** @description Buyer information for custom orders from the Amazon Custom program. */
        BuyerCustomizedInfoDetail: {
            /** @description The location of a ZIP file containing Amazon Custom data. */
            CustomizedURL?: string;
        };
        /** @description Buyer information. */
        BuyerInfo: {
            /** @description The county of the buyer.
             *
             *     **Note**: This attribute is only available in the Brazil marketplace. */
            BuyerCounty?: string;
            /** @description The anonymized email address of the buyer. */
            BuyerEmail?: string;
            /** @description The buyer name or the recipient name. */
            BuyerName?: string;
            BuyerTaxInfo?: components["schemas"]["BuyerTaxInfo"];
            /** @description The purchase order (PO) number entered by the buyer at checkout. Only returned for orders where the buyer entered a PO number at checkout. */
            PurchaseOrderNumber?: string;
        };
        /** @description Information about whether or not a buyer requested cancellation. */
        BuyerRequestedCancel: {
            /** @description The reason that the buyer requested cancellation. */
            BuyerCancelReason?: string;
            /** @description Indicate whether the buyer has requested cancellation.
             *
             *     **Possible Values**: `true`, `false`. */
            IsBuyerRequestedCancel?: string;
        };
        /** @description Tax information about the buyer. */
        BuyerTaxInfo: {
            /** @description The legal name of the company. */
            CompanyLegalName?: string;
            /** @description A list of tax classifications that apply to the order. */
            TaxClassifications?: components["schemas"]["TaxClassification"][];
            /** @description The country or region imposing the tax. */
            TaxingRegion?: string;
        };
        /** @description Contains the business invoice tax information. Available only in the TR marketplace. */
        BuyerTaxInformation: {
            /** @description Business buyer's address. */
            BuyerBusinessAddress?: string;
            /** @description Business buyer's company legal name. */
            BuyerLegalCompanyName?: string;
            /** @description Business buyer's tax office. */
            BuyerTaxOffice?: string;
            /** @description Business buyer's tax registration ID. */
            BuyerTaxRegistrationId?: string;
        };
        /** @description The error response schema for the `confirmShipment` operation. */
        ConfirmShipmentErrorResponse: {
            errors?: components["schemas"]["ErrorList"];
        };
        /** @description A single order item. */
        ConfirmShipmentOrderItem: {
            /** @description The order item's unique identifier. */
            orderItemId: string;
            /** @description The item's quantity. */
            quantity: number;
            transparencyCodes?: components["schemas"]["TransparencyCodeList"];
        };
        /** @description A list of order items. */
        ConfirmShipmentOrderItemsList: components["schemas"]["ConfirmShipmentOrderItem"][];
        /** @description The request schema for an shipment confirmation. */
        ConfirmShipmentRequest: {
            /**
             * @description The COD collection method (only supported in the JP marketplace).
             * @enum {string}
             */
            codCollectionMethod?: "DirectPayment";
            marketplaceId: components["schemas"]["MarketplaceId"];
            packageDetail: components["schemas"]["PackageDetail"];
        };
        /**
         * @description Details the importance of the constraint present on the item
         * @enum {string}
         */
        ConstraintType: "MANDATORY";
        /** @description Contains all of the delivery instructions provided by the customer for the shipping address. */
        DeliveryPreferences: {
            /** @description Building instructions, nearby landmark or navigation instructions. */
            AddressInstructions?: string;
            /** @description Drop-off location selected by the customer. */
            DropOffLocation?: string;
            /** @description Enumerated list of miscellaneous delivery attributes associated with the shipping address. */
            OtherAttributes?: components["schemas"]["OtherDeliveryAttributes"][];
            PreferredDeliveryTime?: components["schemas"]["PreferredDeliveryTime"];
        };
        /**
         * @description The status of the Amazon Easy Ship order. This property is only included for Amazon Easy Ship orders.
         * @enum {string}
         */
        EasyShipShipmentStatus: "PendingSchedule" | "PendingPickUp" | "PendingDropOff" | "LabelCanceled" | "PickedUp" | "DroppedOff" | "AtOriginFC" | "AtDestinationFC" | "Delivered" | "RejectedByBuyer" | "Undeliverable" | "ReturningToSeller" | "ReturnedToSeller" | "Lost" | "OutForDelivery" | "Damaged";
        /**
         * @description The status of the electronic invoice. Only available for Easy Ship orders and orders in the BR marketplace.
         * @enum {string}
         */
        ElectronicInvoiceStatus: "NotRequired" | "NotFound" | "Processing" | "Errored" | "Accepted";
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
        ErrorList: components["schemas"]["Error"][];
        /** @description Dates when the business is closed or open with a different time window. */
        ExceptionDates: {
            /** @description Date when the business is closed, in <a href='https://developer-docs.amazon.com/sp-api/docs/iso-8601'>ISO 8601</a> date format. */
            ExceptionDate?: string;
            /** @description Boolean indicating if the business is closed or open on that date. */
            IsOpen?: boolean;
            /** @description Time window during the day when the business is open. */
            OpenIntervals?: components["schemas"]["OpenInterval"][];
        };
        /** @description Contains the instructions about the fulfillment, such as the location from where you want the order filled. */
        FulfillmentInstruction: {
            /** @description The `sourceId` of the location from where you want the order fulfilled. */
            FulfillmentSupplySourceId?: string;
        };
        /** @description The response schema for the `getOrderAddress` operation. */
        GetOrderAddressResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrderAddress"];
        };
        /** @description The response schema for the `getOrderBuyerInfo` operation. */
        GetOrderBuyerInfoResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrderBuyerInfo"];
        };
        /** @description The response schema for the `getOrderItemsBuyerInfo` operation. */
        GetOrderItemsBuyerInfoResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrderItemsBuyerInfoList"];
        };
        /** @description The response schema for the `getOrderItems` operation. */
        GetOrderItemsResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrderItemsList"];
        };
        /** @description The response schema for the `getOrderRegulatedInfo` operation. */
        GetOrderRegulatedInfoResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrderRegulatedInfo"];
        };
        /** @description The response schema for the `getOrder` operation. */
        GetOrderResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["Order"];
        };
        /** @description The response schema for the `getOrders` operation. */
        GetOrdersResponse: {
            errors?: components["schemas"]["ErrorList"];
            payload?: components["schemas"]["OrdersList"];
        };
        /** @description A single item's buyer information. */
        ItemBuyerInfo: {
            BuyerCustomizedInfo?: components["schemas"]["BuyerCustomizedInfoDetail"];
            /** @description A gift message provided by the buyer.
             *
             *     **Note**: This attribute is only available for MFN (fulfilled by seller) orders. */
            GiftMessageText?: string;
            /** @description The gift wrap level specified by the buyer. */
            GiftWrapLevel?: string;
            GiftWrapPrice?: components["schemas"]["Money"];
            GiftWrapTax?: components["schemas"]["Money"];
        };
        /** @description The unobfuscated marketplace identifier. */
        MarketplaceId: string;
        /** @description Tax information about the marketplace. */
        MarketplaceTaxInfo: {
            /** @description A list of tax classifications that apply to the order. */
            TaxClassifications?: components["schemas"]["TaxClassification"][];
        };
        /** @description Measurement information for an order item. */
        Measurement: {
            /**
             * @description The unit of measure.
             * @enum {string}
             */
            Unit: "OUNCES" | "POUNDS" | "KILOGRAMS" | "GRAMS" | "MILLIGRAMS" | "INCHES" | "FEET" | "METERS" | "CENTIMETERS" | "MILLIMETERS" | "SQUARE_METERS" | "SQUARE_CENTIMETERS" | "SQUARE_FEET" | "SQUARE_INCHES" | "GALLONS" | "PINTS" | "QUARTS" | "FLUID_OUNCES" | "LITERS" | "CUBIC_METERS" | "CUBIC_FEET" | "CUBIC_INCHES" | "CUBIC_CENTIMETERS" | "COUNT";
            /** @description The measurement value. */
            Value: number;
        };
        /** @description The monetary value of the order. */
        Money: {
            /** @description The currency amount. */
            Amount?: string;
            /** @description The three-digit currency code. In ISO 4217 format. */
            CurrencyCode?: string;
        };
        /** @description The time interval for which the business is open. */
        OpenInterval: {
            EndTime?: components["schemas"]["OpenTimeInterval"];
            StartTime?: components["schemas"]["OpenTimeInterval"];
        };
        /** @description The time when the business opens or closes. */
        OpenTimeInterval: {
            /** @description The hour when the business opens or closes. */
            Hour?: number;
            /** @description The minute when the business opens or closes. */
            Minute?: number;
        };
        /** @description Order information. */
        Order: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            AutomatedShippingSettings?: components["schemas"]["AutomatedShippingSettings"];
            BuyerInfo?: components["schemas"]["BuyerInfo"];
            /**
             * @description The buyer's invoicing preference. Sellers can use this data to issue electronic invoices for orders in Turkey.
             *
             *     **Note**: This attribute is only available in the Turkey marketplace.
             * @enum {string}
             */
            BuyerInvoicePreference?: "INDIVIDUAL" | "BUSINESS";
            BuyerTaxInformation?: components["schemas"]["BuyerTaxInformation"];
            /** @description Custom ship label for Checkout by Amazon (CBA). */
            CbaDisplayableShippingLabel?: string;
            DefaultShipFromLocationAddress?: components["schemas"]["Address"];
            /** @description The start of the time period within which you have committed to fulfill the order. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. Only returned for seller-fulfilled orders. */
            EarliestDeliveryDate?: string;
            /** @description The start of the time period within which you have committed to ship the order. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. Only returned for seller-fulfilled orders.
             *
             *     __Note__: `EarliestShipDate` might not be returned for orders placed before February 1, 2013. */
            EarliestShipDate?: string;
            EasyShipShipmentStatus?: components["schemas"]["EasyShipShipmentStatus"];
            ElectronicInvoiceStatus?: components["schemas"]["ElectronicInvoiceStatus"];
            /**
             * @description Whether the order was fulfilled by Amazon (`AFN`) or by the seller (`MFN`).
             * @enum {string}
             */
            FulfillmentChannel?: "MFN" | "AFN";
            FulfillmentInstruction?: components["schemas"]["FulfillmentInstruction"];
            /** @description Whether the order contains regulated items which may require additional approval steps before being fulfilled. */
            HasRegulatedItems?: boolean;
            /** @description When true, this order is marked to be delivered to an Access Point. The access location is chosen by the customer. Access Points include Amazon Hub Lockers, Amazon Hub Counters, and pickup points operated by carriers. */
            IsAccessPointOrder?: boolean;
            /** @description When true, the order is an Amazon Business order. An Amazon Business order is an order where the buyer is a Verified Business Buyer. */
            IsBusinessOrder?: boolean;
            /** @description When true, the estimated ship date is set for the order. Only returned for Sourcing on Demand orders. */
            IsEstimatedShipDateSet?: boolean;
            /** @description When true, the order is a `GlobalExpress` order. */
            IsGlobalExpressEnabled?: boolean;
            /** @description When true, the item within this order was bought and re-sold by Amazon Business EU SARL (ABEU). By buying and instantly re-selling your items, ABEU becomes the seller of record, making your inventory available for sale to customers who would not otherwise purchase from a third-party seller. */
            IsIBA?: boolean;
            /** @description When true, this order is marked to be picked up from a store rather than delivered. */
            IsISPU?: boolean;
            /** @description When true, the order has a Premium Shipping Service Level Agreement. For more information about Premium Shipping orders, refer to "Premium Shipping Options" in the Seller Central Help for your marketplace. */
            IsPremiumOrder?: boolean;
            /** @description When true, the order is a seller-fulfilled Amazon Prime order. */
            IsPrime?: boolean;
            /** @description When true, this is a replacement order. */
            IsReplacementOrder?: boolean;
            /** @description When true, the item within this order was bought and re-sold by Amazon Business EU SARL (ABEU). By buying and instantly re-selling your items, ABEU becomes the seller of record, making your inventory available for sale to customers who would not otherwise purchase from a third-party seller. */
            IsSoldByAB?: boolean;
            /** @description The date when the order was last updated.
             *
             *     __Note__: `LastUpdateDate` is returned with an incorrect date for orders that were last updated before 2009-04-01. */
            LastUpdateDate: string;
            /** @description The end of the time period within which you have committed to fulfill the order. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. Only returned for seller-fulfilled orders that do not have a `PendingAvailability`, `Pending`, or `Canceled` status. */
            LatestDeliveryDate?: string;
            /** @description The end of the time period within which you have committed to ship the order. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. Only returned for seller-fulfilled orders.
             *
             *     __Note__: `LatestShipDate` might not be returned for orders placed before February 1, 2013. */
            LatestShipDate?: string;
            /** @description The identifier for the marketplace where the order was placed. */
            MarketplaceId?: string;
            MarketplaceTaxInfo?: components["schemas"]["MarketplaceTaxInfo"];
            /** @description The number of items shipped. */
            NumberOfItemsShipped?: number;
            /** @description The number of items unshipped. */
            NumberOfItemsUnshipped?: number;
            /** @description The order channel for the first item in the order. */
            OrderChannel?: string;
            /**
             * @description The current order status.
             * @enum {string}
             */
            OrderStatus: "Pending" | "Unshipped" | "PartiallyShipped" | "Shipped" | "Canceled" | "Unfulfillable" | "InvoiceUnconfirmed" | "PendingAvailability";
            OrderTotal?: components["schemas"]["Money"];
            /**
             * @description The order's type.
             * @enum {string}
             */
            OrderType?: "StandardOrder" | "LongLeadTimeOrder" | "Preorder" | "BackOrder" | "SourcingOnDemandOrder";
            PaymentExecutionDetail?: components["schemas"]["PaymentExecutionDetailItemList"];
            /**
             * @description The payment method for the order. This property is limited to COD and CVS payment methods. Unless you need the specific COD payment information provided by the `PaymentExecutionDetailItem` object, we recommend using the `PaymentMethodDetails` property to get payment method information.
             * @enum {string}
             */
            PaymentMethod?: "COD" | "CVS" | "Other";
            PaymentMethodDetails?: components["schemas"]["PaymentMethodDetailItemList"];
            /** @description Indicates the date by which the seller must respond to the buyer with an estimated ship date. Only returned for Sourcing on Demand orders. */
            PromiseResponseDueDate?: string;
            /** @description The date when the order was created. */
            PurchaseDate: string;
            /** @description The order ID value for the order that is being replaced. Returned only if IsReplacementOrder = true. */
            ReplacedOrderId?: string;
            /** @description The sales channel for the first item in the order. */
            SalesChannel?: string;
            /** @description The seller’s friendly name registered in the marketplace where the sale took place. Sellers can use this data to issue electronic invoices for orders in Brazil.
             *
             *     **Note**: This attribute is only available in the Brazil marketplace for the orders with `Pending` or `Unshipped` status. */
            SellerDisplayName?: string;
            /** @description A seller-defined order identifier. */
            SellerOrderId?: string;
            /** @description The shipment service level category for the order.
             *
             *     **Possible values**: `Expedited`, `FreeEconomy`, `NextDay`, `Priority`, `SameDay`, `SecondDay`, `Scheduled`, and `Standard`. */
            ShipmentServiceLevelCategory?: string;
            ShippingAddress?: components["schemas"]["Address"];
            /** @description The order's shipment service level. */
            ShipServiceLevel?: string;
        };
        /** @description The shipping address for the order. */
        OrderAddress: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            /** @description The company name of the contact buyer. For IBA orders, the buyer company must be Amazon entities. */
            BuyerCompanyName?: string;
            DeliveryPreferences?: components["schemas"]["DeliveryPreferences"];
            ShippingAddress?: components["schemas"]["Address"];
        };
        /** @description Buyer information for an order. */
        OrderBuyerInfo: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            /** @description The county of the buyer.
             *
             *     **Note**: This attribute is only available in the Brazil marketplace. */
            BuyerCounty?: string;
            /** @description The anonymized email address of the buyer. */
            BuyerEmail?: string;
            /** @description The buyer name or the recipient name. */
            BuyerName?: string;
            BuyerTaxInfo?: components["schemas"]["BuyerTaxInfo"];
            /** @description The purchase order (PO) number entered by the buyer at checkout. Only returned for orders where the buyer entered a PO number at checkout. */
            PurchaseOrderNumber?: string;
        };
        /** @description A single order item. */
        OrderItem: {
            AmazonPrograms?: components["schemas"]["AmazonPrograms"];
            /** @description The item's Amazon Standard Identification Number (ASIN). */
            ASIN: string;
            /** @description A list of associated items that a customer has purchased with a product. For example, a tire installation service purchased with tires. */
            AssociatedItems?: components["schemas"]["AssociatedItem"][];
            BuyerInfo?: components["schemas"]["ItemBuyerInfo"];
            BuyerRequestedCancel?: components["schemas"]["BuyerRequestedCancel"];
            CODFee?: components["schemas"]["Money"];
            CODFeeDiscount?: components["schemas"]["Money"];
            /** @description The condition of the item.
             *
             *     **Possible values**: `New`, `Used`, `Collectible`, `Refurbished`, `Preorder`, and `Club`. */
            ConditionId?: string;
            /** @description The condition of the item, as described by the seller. */
            ConditionNote?: string;
            /** @description The subcondition of the item.
             *
             *     **Possible values**: `New`, `Mint`, `Very Good`, `Good`, `Acceptable`, `Poor`, `Club`, `OEM`, `Warranty`, `Refurbished Warranty`, `Refurbished`, `Open Box`, `Any`, and `Other`. */
            ConditionSubtypeId?: string;
            /**
             * @description The category of deemed reseller. This applies to selling partners that are not based in the EU and is used to help them meet the VAT Deemed Reseller tax laws in the EU and UK.
             * @enum {string}
             */
            DeemedResellerCategory?: "IOSS" | "UOSS";
            /** @description The IOSS number of the marketplace. Sellers shipping to the EU from outside the EU must provide this IOSS number to their carrier when Amazon has collected the VAT on the sale. */
            IossNumber?: string;
            /** @description Indicates whether the item is a gift.
             *
             *     **Possible values**: `true` and `false`. */
            IsGift?: string;
            /** @description When true, the ASIN is enrolled in Transparency. The Transparency serial number that you must submit is determined by:
             *
             *     **1D or 2D Barcode:** This has a **T** logo. Submit either the 29-character alpha-numeric identifier beginning with **AZ** or **ZA**, or the 38-character Serialized Global Trade Item Number (SGTIN).
             *     **2D Barcode SN:** Submit the 7- to 20-character serial number barcode, which likely has the prefix **SN**. The serial number is applied to the same side of the packaging as the GTIN (UPC/EAN/ISBN) barcode.
             *     **QR code SN:** Submit the URL that the QR code generates. */
            IsTransparency?: boolean;
            ItemPrice?: components["schemas"]["Money"];
            ItemTax?: components["schemas"]["Money"];
            Measurement?: components["schemas"]["Measurement"];
            /** @description An Amazon-defined order item identifier. */
            OrderItemId: string;
            PointsGranted?: components["schemas"]["PointsGrantedDetail"];
            /** @description Indicates that the selling price is a special price that is only available for Amazon Business orders. For more information about the Amazon Business Seller Program, refer to the [Amazon Business website](https://www.amazon.com/b2b/info/amazon-business).
             *
             *     **Possible values**: `BusinessPrice` */
            PriceDesignation?: string;
            ProductInfo?: components["schemas"]["ProductInfoDetail"];
            PromotionDiscount?: components["schemas"]["Money"];
            PromotionDiscountTax?: components["schemas"]["Money"];
            PromotionIds?: components["schemas"]["PromotionIdList"];
            /** @description The number of items in the order.  */
            QuantityOrdered: number;
            /** @description The number of items shipped. */
            QuantityShipped?: number;
            /** @description The end date of the scheduled delivery window in the time zone for the order destination. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. */
            ScheduledDeliveryEndDate?: string;
            /** @description The start date of the scheduled delivery window in the time zone for the order destination. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. */
            ScheduledDeliveryStartDate?: string;
            /** @description The item's seller stock keeping unit (SKU). */
            SellerSKU?: string;
            /** @description When true, the product type for this item has a serial number.
             *
             *      Only returned for Amazon Easy Ship orders. */
            SerialNumberRequired?: boolean;
            /** @description A list of serial numbers for electronic products that are shipped to customers. Returned for FBA orders only. */
            SerialNumbers?: string[];
            ShippingConstraints?: components["schemas"]["ShippingConstraints"];
            ShippingDiscount?: components["schemas"]["Money"];
            ShippingDiscountTax?: components["schemas"]["Money"];
            ShippingPrice?: components["schemas"]["Money"];
            ShippingTax?: components["schemas"]["Money"];
            /** @description The store chain store identifier. Linked to a specific store in a store chain. */
            StoreChainStoreId?: string;
            SubstitutionPreferences?: components["schemas"]["SubstitutionPreferences"];
            TaxCollection?: components["schemas"]["TaxCollection"];
            /** @description The item's name. */
            Title?: string;
        };
        /** @description A single order item's buyer information. */
        OrderItemBuyerInfo: {
            BuyerCustomizedInfo?: components["schemas"]["BuyerCustomizedInfoDetail"];
            /** @description A gift message provided by the buyer.
             *
             *     **Note**: This attribute is only available for MFN (fulfilled by seller) orders. */
            GiftMessageText?: string;
            /** @description The gift wrap level specified by the buyer. */
            GiftWrapLevel?: string;
            GiftWrapPrice?: components["schemas"]["Money"];
            GiftWrapTax?: components["schemas"]["Money"];
            /** @description An Amazon-defined order item identifier. */
            OrderItemId: string;
        };
        /** @description A single order item's buyer information list. */
        OrderItemBuyerInfoList: components["schemas"]["OrderItemBuyerInfo"][];
        /** @description A list of order items. */
        OrderItemList: components["schemas"]["OrderItem"][];
        /** @description For partial shipment status updates, the list of order items and quantities to be updated. */
        OrderItems: {
            /** @description The order item's unique identifier. */
            orderItemId?: string;
            /** @description The quantity for which to update the shipment status. */
            quantity?: number;
        }[];
        /** @description A single order item's buyer information list with the order ID. */
        OrderItemsBuyerInfoList: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            /** @description When present and not empty, pass this string token in the next request to return the next response page. */
            NextToken?: string;
            OrderItems: components["schemas"]["OrderItemBuyerInfoList"];
        };
        /** @description The order items list along with the order ID. */
        OrderItemsList: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            /** @description When present and not empty, pass this string token in the next request to return the next response page. */
            NextToken?: string;
            OrderItems: components["schemas"]["OrderItemList"];
        };
        /** @description A list of orders. */
        OrderList: components["schemas"]["Order"][];
        /** @description The order's regulated information along with its verification status. */
        OrderRegulatedInfo: {
            /** @description An Amazon-defined order identifier, in 3-7-7 format. */
            AmazonOrderId: string;
            RegulatedInformation: components["schemas"]["RegulatedInformation"];
            RegulatedOrderVerificationStatus: components["schemas"]["RegulatedOrderVerificationStatus"];
            /** @description When true, the order requires attaching a dosage information label when shipped. */
            RequiresDosageLabel: boolean;
        };
        /** @description A list of orders along with additional information to make subsequent API calls. */
        OrdersList: {
            /** @description Use this date to select orders created before (or at) a specified time. Only orders placed before the specified time are returned. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. */
            CreatedBefore?: string;
            /** @description Use this date to select orders that were last updated before (or at) a specified time. An update is defined as any change in order status, including the creation of a new order. Includes updates made by Amazon and by the seller. Use [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format for all dates. */
            LastUpdatedBefore?: string;
            /** @description When present and not empty, pass this string token in the next request to return the next response page. */
            NextToken?: string;
            Orders: components["schemas"]["OrderList"];
        };
        /**
         * @description Miscellaneous delivery attributes associated with the shipping address.
         * @enum {string}
         */
        OtherDeliveryAttributes: "HAS_ACCESS_POINT" | "PALLET_ENABLED" | "PALLET_DISABLED";
        /** @description Properties of packages */
        PackageDetail: {
            /** @description Identifies the carrier that will deliver the package. This field is required for all marketplaces. For more information, refer to the [`CarrierCode` announcement](https://developer-docs.amazon.com/sp-api/changelog/carriercode-value-required-in-shipment-confirmations-for-br-mx-ca-sg-au-in-jp-marketplaces). */
            carrierCode: string;
            /** @description Carrier name that will deliver the package. Required when `carrierCode` is "Other"  */
            carrierName?: string;
            orderItems: components["schemas"]["ConfirmShipmentOrderItemsList"];
            packageReferenceId: components["schemas"]["PackageReferenceId"];
            /**
             * Format: date-time
             * @description The shipping date for the package. Must be in <a href='https://developer-docs.amazon.com/sp-api/docs/iso-8601'>ISO 8601</a> date/time format.
             */
            shipDate: string;
            /** @description The unique identifier for the supply source. */
            shipFromSupplySourceId?: string;
            /** @description Ship method to be used for shipping the order. */
            shippingMethod?: string;
            /** @description The tracking number used to obtain tracking and delivery information. */
            trackingNumber: string;
        };
        /** @description A seller-supplied identifier that uniquely identifies a package within the scope of an order. Only positive numeric values are supported. */
        PackageReferenceId: string;
        /** @description Information about a sub-payment method used to pay for a COD order. */
        PaymentExecutionDetailItem: {
            /** @description The Brazilian Taxpayer Identifier (CNPJ) of the payment processor or acquiring bank that authorizes the payment.
             *
             *     **Note**: This attribute is only available for orders in the Brazil (BR) marketplace when the `PaymentMethod` is `CreditCard` or `Pix`. */
            AcquirerId?: string;
            /** @description The unique code that confirms the payment authorization.
             *
             *     **Note**: This attribute is only available for orders in the Brazil (BR) marketplace when the `PaymentMethod` is `CreditCard` or `Pix`. */
            AuthorizationCode?: string;
            /** @description The card network or brand used in the payment transaction (for example, Visa or Mastercard).
             *
             *     **Note**: This attribute is only available for orders in the Brazil (BR) marketplace when the `PaymentMethod` is `CreditCard`. */
            CardBrand?: string;
            Payment: components["schemas"]["Money"];
            /** @description The sub-payment method for an order.
             *
             *     **Possible values**:
             *     * `COD`: Cash on delivery
             *     * `GC`: Gift card
             *     * `PointsAccount`: Amazon Points
             *     * `Invoice`: Invoice
             *     * `CreditCard`: Credit card
             *     * `Pix`: Pix
             *     * `Other`: Other. */
            PaymentMethod: string;
        };
        /** @description A list of payment execution detail items. */
        PaymentExecutionDetailItemList: components["schemas"]["PaymentExecutionDetailItem"][];
        /** @description A list of payment method detail items. */
        PaymentMethodDetailItemList: string[];
        /** @description The number of Amazon Points offered with the purchase of an item, and their monetary value. */
        PointsGrantedDetail: {
            PointsMonetaryValue?: components["schemas"]["Money"];
            /** @description The number of Amazon Points granted with the purchase of an item. */
            PointsNumber?: number;
        };
        /** @description The time window when the delivery is preferred. */
        PreferredDeliveryTime: {
            /** @description Business hours when the business is open for deliveries. */
            BusinessHours?: components["schemas"]["BusinessHours"][];
            /** @description Dates when the business is closed during the next 30 days. */
            ExceptionDates?: components["schemas"]["ExceptionDates"][];
        };
        /** @description Information about the prescription that is used to verify a regulated product. This must be provided once per order and reflect the seller’s own records. Only approved orders can have prescriptions. */
        PrescriptionDetail: {
            /** @description The identifier for the clinic which provided the prescription used to verify the regulated product. */
            clinicId: string;
            /**
             * Format: date-time
             * @description The expiration date of the prescription used to verify the regulated product, in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format.
             */
            expirationDate: string;
            /** @description The identifier for the prescription used to verify the regulated product. */
            prescriptionId: string;
            /** @description The number of refills remaining for the prescription used to verify the regulated product. If a prescription originally had 10 total refills, this value must be `10` for the first order, `9` for the second order, and `0` for the eleventh order. If a prescription originally had no refills, this value must be 0. */
            refillsRemaining: number;
            /** @description The total number of refills written in the original prescription used to verify the regulated product. If a prescription originally had no refills, this value must be 0. */
            totalRefillsAuthorized: number;
            /** @description The instructions for the prescription as provided by the approver of the regulated product. */
            usageInstructions: string;
            /** @description The number of units in each fill as provided in the prescription. */
            writtenQuantity: number;
        };
        /** @description Product information on the number of items. */
        ProductInfoDetail: {
            /** @description The total number of items that are included in the ASIN. */
            NumberOfItems?: string;
        };
        /** @description A list of promotion identifiers provided by the seller when the promotions were created. */
        PromotionIdList: string[];
        /** @description The regulated information collected during purchase and used to verify the order. */
        RegulatedInformation: {
            /** @description A list of regulated information fields as collected from the regulatory form. */
            Fields: components["schemas"]["RegulatedInformationField"][];
        };
        /** @description A field collected from the regulatory form. */
        RegulatedInformationField: {
            /** @description The unique identifier of the field. */
            FieldId: string;
            /** @description The name of the field. */
            FieldLabel: string;
            /**
             * @description The type of field.
             * @enum {string}
             */
            FieldType: "Text" | "FileAttachment";
            /** @description The content of the field as collected in regulatory form. Note that `FileAttachment` type fields contain a URL where you can download the attachment. */
            FieldValue: string;
        };
        /** @description The verification status of the order, along with associated approval or rejection metadata. */
        RegulatedOrderVerificationStatus: {
            /** @description The identifier for the order's regulated information reviewer. */
            ExternalReviewerId?: string;
            RejectionReason?: components["schemas"]["RejectionReason"];
            /** @description When true, the regulated information provided in the order requires a review by the merchant. */
            RequiresMerchantAction: boolean;
            /** @description The date the order was reviewed. In [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) date time format. */
            ReviewDate?: string;
            Status: components["schemas"]["VerificationStatus"];
            /** @description A list of valid rejection reasons that may be used to reject the order's regulated information. */
            ValidRejectionReasons: components["schemas"]["RejectionReason"][];
            /** @description A list of valid verification details that may be provided and the criteria required for when the verification detail can be provided. */
            ValidVerificationDetails?: components["schemas"]["ValidVerificationDetail"][];
        };
        /** @description The reason for rejecting the order's regulated information. This is only present if the order is rejected. */
        RejectionReason: {
            /** @description The description of this rejection reason. */
            RejectionReasonDescription: string;
            /** @description The unique identifier for the rejection reason. */
            RejectionReasonId: string;
        };
        /**
         * @description The shipment status to apply.
         * @enum {string}
         */
        ShipmentStatus: "ReadyForPickup" | "PickedUp" | "RefusedPickup";
        /** @description Delivery constraints applicable to this order. */
        ShippingConstraints: {
            PalletDelivery?: components["schemas"]["ConstraintType"];
            RecipientAgeVerification?: components["schemas"]["ConstraintType"];
            RecipientIdentityVerification?: components["schemas"]["ConstraintType"];
            SignatureConfirmation?: components["schemas"]["ConstraintType"];
        };
        /** @description Substitution options for an order item. */
        SubstitutionOption: {
            /** @description The item's Amazon Standard Identification Number (ASIN). */
            ASIN?: string;
            Measurement?: components["schemas"]["Measurement"];
            /** @description The number of items to be picked for this substitution option.  */
            QuantityOrdered?: number;
            /** @description The item's seller stock keeping unit (SKU). */
            SellerSKU?: string;
            /** @description The item's title. */
            Title?: string;
        };
        /** @description A collection of substitution options. */
        SubstitutionOptionList: components["schemas"]["SubstitutionOption"][];
        /** @description Substitution preferences for an order item. */
        SubstitutionPreferences: {
            SubstitutionOptions?: components["schemas"]["SubstitutionOptionList"];
            /**
             * @description The type of substitution that these preferences represent.
             * @enum {string}
             */
            SubstitutionType: "CUSTOMER_PREFERENCE" | "AMAZON_RECOMMENDED" | "DO_NOT_SUBSTITUTE";
        };
        /** @description The tax classification of the order. */
        TaxClassification: {
            /** @description The type of tax. */
            Name?: string;
            /** @description The buyer's tax identifier. */
            Value?: string;
        };
        /** @description Information about withheld taxes. */
        TaxCollection: {
            /**
             * @description The tax collection model applied to the item.
             * @enum {string}
             */
            Model?: "MarketplaceFacilitator";
            /**
             * @description The party responsible for withholding the taxes and remitting them to the taxing authority.
             * @enum {string}
             */
            ResponsibleParty?: "Amazon Services, Inc.";
        };
        /** @description The transparency code associated with the item. */
        TransparencyCode: string;
        /** @description A list of order items. */
        TransparencyCodeList: components["schemas"]["TransparencyCode"][];
        /** @description The error response schema for the `UpdateShipmentStatus` operation. */
        UpdateShipmentStatusErrorResponse: {
            errors?: components["schemas"]["ErrorList"];
        };
        /** @description The request body for the `updateShipmentStatus` operation. */
        UpdateShipmentStatusRequest: {
            marketplaceId: components["schemas"]["MarketplaceId"];
            orderItems?: components["schemas"]["OrderItems"];
            shipmentStatus: components["schemas"]["ShipmentStatus"];
        };
        /** @description The error response schema for the `UpdateVerificationStatus` operation. */
        UpdateVerificationStatusErrorResponse: {
            errors?: components["schemas"]["ErrorList"];
        };
        /** @description The request body for the `updateVerificationStatus` operation. */
        UpdateVerificationStatusRequest: {
            regulatedOrderVerificationStatus: components["schemas"]["UpdateVerificationStatusRequestBody"];
        };
        /** @description The updated values of the `VerificationStatus` field. */
        UpdateVerificationStatusRequestBody: {
            /** @description The identifier of the order's regulated information reviewer. */
            externalReviewerId: string;
            /** @description The unique identifier of the rejection reason used for rejecting the order's regulated information. Only required if the new status is rejected. */
            rejectionReasonId?: string;
            status?: components["schemas"]["VerificationStatus"];
            verificationDetails?: components["schemas"]["VerificationDetails"];
        };
        /** @description The types of verification details that may be provided for the order and the criteria required for when the type of verification detail can be provided. The types of verification details allowed depend on the type of regulated product and will not change order to order. */
        ValidVerificationDetail: {
            /** @description A list of valid verification statuses where the associated verification detail type may be provided. For example, if the value of this field is ["Approved"], calls to provide the associated verification detail will fail for orders with a `VerificationStatus` of `Pending`, `Rejected`, `Expired`, or `Cancelled`. */
            ValidVerificationStatuses: components["schemas"]["VerificationStatus"][];
            /** @description A supported type of verification detail. The type indicates which verification detail could be shared while updating the regulated order. Valid value: `prescriptionDetail`. */
            VerificationDetailType: string;
        };
        /** @description Additional information related to the verification of a regulated order. */
        VerificationDetails: {
            prescriptionDetail?: components["schemas"]["PrescriptionDetail"];
        };
        /**
         * @description The verification status of the order.
         * @enum {string}
         */
        VerificationStatus: "Pending" | "Approved" | "Rejected" | "Expired" | "Cancelled";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getOrders: {
        parameters: {
            query: {
                /** @description The `sourceId` of the location from where you want the order fulfilled. */
                ActualFulfillmentSupplySourceId?: string;
                /** @description A list of `AmazonOrderId` values. An `AmazonOrderId` is an Amazon-defined order identifier, in 3-7-7 format. */
                AmazonOrderIds?: string[];
                /** @description The email address of a buyer. Used to select orders that contain the specified email address. */
                BuyerEmail?: string;
                /** @description Use this date to select orders created after (or at) a specified time. Only orders placed after the specified time are returned. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format.
                 *
                 *     **Note**: Either the `CreatedAfter` parameter or the `LastUpdatedAfter` parameter is required. Both cannot be empty. `LastUpdatedAfter` and `LastUpdatedBefore` cannot be set when `CreatedAfter` is set. */
                CreatedAfter?: string;
                /** @description Use this date to select orders created before (or at) a specified time. Only orders placed before the specified time are returned. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format.
                 *
                 *     **Note**: `CreatedBefore` is optional when `CreatedAfter` is set. If specified, `CreatedBefore` must be equal to or after the `CreatedAfter` date and at least two minutes before current time. */
                CreatedBefore?: string;
                /** @description Use this date to select orders with a earliest delivery date after (or at) a specified time. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. */
                EarliestDeliveryDateAfter?: string;
                /** @description Use this date to select orders with a earliest delivery date before (or at) a specified time. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. */
                EarliestDeliveryDateBefore?: string;
                /** @description A list of `EasyShipShipmentStatus` values. Used to select Easy Ship orders with statuses that match the specified values. If `EasyShipShipmentStatus` is specified, only Amazon Easy Ship orders are returned.
                 *
                 *     **Possible values:**
                 *     - `PendingSchedule` (The package is awaiting the schedule for pick-up.)
                 *     - `PendingPickUp` (Amazon has not yet picked up the package from the seller.)
                 *     - `PendingDropOff` (The seller will deliver the package to the carrier.)
                 *     - `LabelCanceled` (The seller canceled the pickup.)
                 *     - `PickedUp` (Amazon has picked up the package from the seller.)
                 *     - `DroppedOff` (The package is delivered to the carrier by the seller.)
                 *     - `AtOriginFC` (The packaged is at the origin fulfillment center.)
                 *     - `AtDestinationFC` (The package is at the destination fulfillment center.)
                 *     - `Delivered` (The package has been delivered.)
                 *     - `RejectedByBuyer` (The package has been rejected by the buyer.)
                 *     - `Undeliverable` (The package cannot be delivered.)
                 *     - `ReturningToSeller` (The package was not delivered and is being returned to the seller.)
                 *     - `ReturnedToSeller` (The package was not delivered and was returned to the seller.)
                 *     - `Lost` (The package is lost.)
                 *     - `OutForDelivery` (The package is out for delivery.)
                 *     - `Damaged` (The package was damaged by the carrier.) */
                EasyShipShipmentStatuses?: string[];
                /** @description A list of `ElectronicInvoiceStatus` values. Used to select orders with electronic invoice statuses that match the specified values.
                 *
                 *     **Possible values:**
                 *     - `NotRequired` (Electronic invoice submission is not required for this order.)
                 *     - `NotFound` (The electronic invoice was not submitted for this order.)
                 *     - `Processing` (The electronic invoice is being processed for this order.)
                 *     - `Errored` (The last submitted electronic invoice was rejected for this order.)
                 *     - `Accepted` (The last submitted electronic invoice was submitted and accepted.) */
                ElectronicInvoiceStatuses?: string[];
                /** @description A list that indicates how an order was fulfilled. Filters the results by fulfillment channel.
                 *
                 *     **Possible values**: `AFN` (fulfilled by Amazon), `MFN` (fulfilled by seller). */
                FulfillmentChannels?: string[];
                /** @description When true, this order is marked to be picked up from a store rather than delivered. */
                IsISPU?: boolean;
                /** @description Use this date to select orders that were last updated after (or at) a specified time. An update is defined as any change in order status, including the creation of a new order. Includes updates made by Amazon and by the seller. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format.
                 *
                 *     **Note**: Either the `CreatedAfter` parameter or the `LastUpdatedAfter` parameter is required. Both cannot be empty. `CreatedAfter` or `CreatedBefore` cannot be set when `LastUpdatedAfter` is set. */
                LastUpdatedAfter?: string;
                /** @description Use this date to select orders that were last updated before (or at) a specified time. An update is defined as any change in order status, including the creation of a new order. Includes updates made by Amazon and by the seller. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format.
                 *
                 *     **Note**: `LastUpdatedBefore` is optional when `LastUpdatedAfter` is set. But if specified, `LastUpdatedBefore` must be equal to or after the `LastUpdatedAfter` date and at least two minutes before current time. */
                LastUpdatedBefore?: string;
                /** @description Use this date to select orders with a latest delivery date after (or at) a specified time. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. */
                LatestDeliveryDateAfter?: string;
                /** @description Use this date to select orders with a latest delivery date before (or at) a specified time. The date must be in [ISO 8601](https://developer-docs.amazon.com/sp-api/docs/iso-8601) format. */
                LatestDeliveryDateBefore?: string;
                /** @description A list of `MarketplaceId` values. Used to select orders that were placed in the specified marketplaces.
                 *
                 *     Refer to [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids) for a complete list of `marketplaceId` values. */
                MarketplaceIds: string[];
                /** @description A number that indicates the maximum number of orders that can be returned per page. Value must be 1 - 100. Default 100. */
                MaxResultsPerPage?: number;
                /** @description A string token returned in the response of your previous request. */
                NextToken?: string;
                /** @description A list of `OrderStatus` values used to filter the results.
                 *
                 *     **Possible values:**
                 *     - `PendingAvailability` (This status is available for pre-orders only. The order has been placed, payment has not been authorized, and the release date of the item is in the future.)
                 *     - `Pending` (The order has been placed but payment has not been authorized.)
                 *     - `Unshipped` (Payment has been authorized and the order is ready for shipment, but no items in the order have been shipped.)
                 *     - `PartiallyShipped` (One or more, but not all, items in the order have been shipped.)
                 *     - `Shipped` (All items in the order have been shipped.)
                 *     - `InvoiceUnconfirmed` (All items in the order have been shipped. The seller has not yet given confirmation to Amazon that the invoice has been shipped to the buyer.)
                 *     - `Canceled` (The order has been canceled.)
                 *     - `Unfulfillable` (The order cannot be fulfilled. This state applies only to Multi-Channel Fulfillment orders.) */
                OrderStatuses?: string[];
                /** @description A list of payment method values. Use this field to select orders that were paid with the specified payment methods.
                 *
                 *     **Possible values**: `COD` (cash on delivery), `CVS` (convenience store), `Other` (Any payment method other than COD or CVS). */
                PaymentMethods?: string[];
                /** @description An order identifier that is specified by the seller. Used to select only the orders that match the order identifier. If `SellerOrderId` is specified, then `FulfillmentChannels`, `OrderStatuses`, `PaymentMethod`, `LastUpdatedAfter`, LastUpdatedBefore, and `BuyerEmail` cannot be specified. */
                SellerOrderId?: string;
                /** @description The store chain store identifier. Linked to a specific store in a store chain. */
                StoreChainStoreId?: string;
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrdersResponse"];
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
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
                    "application/json": components["schemas"]["GetOrdersResponse"];
                };
            };
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description An Amazon-defined order identifier, in 3-7-7 format. */
                orderId: string;
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
                    "application/json": components["schemas"]["GetOrderResponse"];
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
                    "application/json": components["schemas"]["GetOrderResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderResponse"];
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
                    "application/json": components["schemas"]["GetOrderResponse"];
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
                    "application/json": components["schemas"]["GetOrderResponse"];
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
                    "application/json": components["schemas"]["GetOrderResponse"];
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
                    "application/json": components["schemas"]["GetOrderResponse"];
                };
            };
        };
    };
    getOrderAddress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The Amazon order identifier in 3-7-7 format. */
                orderId: string;
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
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
                    "application/json": components["schemas"]["GetOrderAddressResponse"];
                };
            };
        };
    };
    getOrderBuyerInfo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The Amazon order identifier in 3-7-7 format. */
                orderId: string;
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderBuyerInfoResponse"];
                };
            };
        };
    };
    getOrderItems: {
        parameters: {
            query?: {
                /** @description A string token returned in the response of your previous request. */
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsResponse"];
                };
            };
        };
    };
    getOrderItemsBuyerInfo: {
        parameters: {
            query?: {
                /** @description A string token returned in the response of your previous request. */
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderItemsBuyerInfoResponse"];
                };
            };
        };
    };
    getOrderRegulatedInfo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The Amazon order identifier in 3-7-7 format. */
                orderId: string;
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
                    ApprovedOrder: unknown;
                    PendingOrder: unknown;
                    RejectedOrder: unknown;
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
                };
            };
            /** @description Indicates access to the resource is forbidden. Possible reasons include Access Denied, Unauthorized, Expired Token, or Invalid Signature. */
            403: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
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
                    "application/json": components["schemas"]["GetOrderRegulatedInfoResponse"];
                };
            };
        };
    };
    updateVerificationStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The Amazon order identifier in 3-7-7 format. */
                orderId: string;
            };
            cookie?: never;
        };
        /** @description The request body for the `updateVerificationStatus` operation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateVerificationStatusRequest"];
            };
        };
        responses: {
            /** @description Success. */
            204: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content?: never;
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateVerificationStatusErrorResponse"];
                };
            };
        };
    };
    updateShipmentStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description An Amazon-defined order identifier, in 3-7-7 format. */
                orderId: string;
            };
            cookie?: never;
        };
        /** @description The request body for the `updateShipmentStatus` operation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateShipmentStatusRequest"];
            };
        };
        responses: {
            /** @description Success. */
            204: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content?: never;
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
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
                    "application/json": components["schemas"]["UpdateShipmentStatusErrorResponse"];
                };
            };
        };
    };
    confirmShipment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description An Amazon-defined order identifier, in 3-7-7 format. */
                orderId: string;
            };
            cookie?: never;
        };
        /** @description Request body of `confirmShipment`. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmShipmentRequest"];
            };
        };
        responses: {
            /** @description Success. */
            204: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content?: never;
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
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
                };
            };
            /** @description The request's Authorization header is not formatted correctly or does not contain a valid token. */
            401: {
                headers: {
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
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
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
                };
            };
            /** @description The specified resource does not exist. */
            404: {
                headers: {
                    /** @description Your rate limit (requests per second) for this operation. */
                    "x-amzn-RateLimit-Limit"?: string;
                    /** @description Unique request reference identifier. */
                    "x-amzn-RequestId"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
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
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
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
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
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
                    "application/json": components["schemas"]["ConfirmShipmentErrorResponse"];
                };
            };
        };
    };
}
