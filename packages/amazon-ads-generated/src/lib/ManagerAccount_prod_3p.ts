export type paths = {
    "/managerAccounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Returns all manager accounts that a given Amazon Ads user has access to.
         * @description Returns all [manager accounts](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8) that a user has access to, along with metadata for the Amazon Ads accounts that are linked to each manager account. NOTE: A maximum of 50 linked accounts are returned for each manager account.
         */
        get: operations["getManagerAccountsForUser"];
        put?: never;
        /**
         * Creates a new Amazon Advertising Manager account.
         * @description Creates a new Amazon Advertising [Manager account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8).
         */
        post: operations["createManagerAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managerAccounts/{managerAccountId}/associate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Link Amazon Advertising accounts or advertisers with a Manager Account.
         * @description Link Amazon Advertising accounts or advertisers with a [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8).
         */
        post: operations["LinkAdvertisingAccountsToManagerAccountPublicAPI"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managerAccounts/{managerAccountId}/disassociate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unlink Amazon Advertising accounts or advertisers with a Manager Account.
         * @description Unlink Amazon Advertising accounts or advertisers with a [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8).
         */
        post: operations["UnlinkAdvertisingAccountsToManagerAccountPublicAPI"];
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
        /** @description Object representation of an Amazon Advertising account. */
        Account: {
            /** @description Id of the Amazon Advertising account. */
            accountId?: string;
            /** @description The name given to the Amazon Advertising account. */
            accountName?: string;
            accountType?: components["schemas"]["AccountType"];
            /** @description The identifier of a DSP advertiser. Note that this value is only populated for accounts with type `DSP_ADVERTISING_ACCOUNT`. It will be `null` for accounts of other types. */
            dspAdvertiserId?: string;
            /** @description The identifier of the marketplace to which the account is associated. See [this table](https://docs.developer.amazonservices.com/en_US/dev_guide/DG_Endpoints.html) for `marketplaceId` mappings. */
            marketplaceId?: string;
            /** @description The identifier of a profile associated with the advertiser account. Note that this value is only populated for a subset of account types: `[ SELLER, VENDOR, MARKETING_CLOUD ]`. It will be `null` for accounts of other types. */
            profileId?: string;
        };
        /**
         * @description The type of a role used in account relationships.
         * @enum {string}
         */
        AccountRelationshipRole: "ENTITY_OWNER" | "ENTITY_USER" | "ENTITY_VIEWER" | "SELLER_USER";
        /** @description String identifier for an Amazon Advertising account or advertiser. `ACCOUNT_ID` is an identifier that is returned by the [Profiles resource](https://advertising.amazon.com/API/docs/en-us/reference/2/profiles#/Profiles/listProfiles), within the `AccountInfo.id` data member. `ACCOUNT_ID` may begin with the string `"ENTITY"`.
         *     `DSP_ADVERTISER_ID` is an identifier for a DSP advertiser, which is returned by the [DSP resource](https://advertising.amazon.com/API/docs/en-us/dsp-advertiser/#/Advertiser/get_dsp_advertisers). */
        AccountToUpdate: {
            /** @description Id of the Amazon Advertising account. */
            id?: string;
            /** @description The types of role that will exist with the Amazon Advertising account. Depending on account type, the default role will be ENTITY_USER or SELLER_USER. Only one role at a time is currently supported */
            roles?: components["schemas"]["AccountRelationshipRole"][];
            /**
             * @description The type of the Id
             * @enum {string}
             */
            type?: "ACCOUNT_ID" | "DSP_ADVERTISER_ID";
        };
        /** @description Object representation of an Amazon Advertising account or [DSP advertiser](https://advertising.amazon.com/API/docs/en-us/dsp-advertiser/#/) that failed to update. */
        AccountToUpdateFailure: {
            account?: components["schemas"]["AccountToUpdate"];
            error?: components["schemas"]["ErrorDetail"];
        };
        /**
         * @description Type of the Amazon Advertising account.
         * @enum {string}
         */
        AccountType: "VENDOR" | "SELLER" | "DSP_ADVERTISING_ACCOUNT" | "MARKETING_CLOUD";
        /** @description Request object that defines the fields required to create a Manager account. */
        CreateManagerAccountRequest: {
            /** @description Name of the Manager account. */
            managerAccountName?: string;
            /**
             * @description Type of the Manager account, which indicates how the Manager account will be used. Use `Advertiser` if the Manager account will be used for **your own** products and services, or `Agency` if you are managing accounts **on behalf of your clients**.
             * @enum {string}
             */
            managerAccountType?: "Advertiser" | "Agency";
        };
        /** @description The error response object. */
        ErrorDetail: {
            /** @enum {string} */
            code?: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVICE_ERROR";
            /** @description A human-readable description of the error. */
            message?: string;
        };
        /** @description Response containing a list of Manager Accounts that a given user has access to. */
        GetManagerAccountsResponse: {
            /** @description List of Manager Accounts that the user has access to */
            managerAccounts?: components["schemas"]["ManagerAccount"][];
        };
        /** @description Object representation of an Amazon Advertising Manager Account. */
        ManagerAccount: {
            linkedAccounts?: components["schemas"]["Account"][];
            /** @description Id of the Manager Account. */
            managerAccountId?: string;
            /** @description The name given to a Manager Account. */
            managerAccountName?: string;
        };
        /** @description A list of Advertising accounts or advertisers to link/unlink with [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8). User can pass a list with a maximum of 20 accounts/advertisers using any mix of identifiers. */
        UpdateAdvertisingAccountsInManagerAccountRequest: {
            /** @description List of Advertising accounts or advertisers to link/unlink with [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8). User can pass a list with a maximum of 20 accounts/advertisers using any mix of identifiers. */
            accounts?: components["schemas"]["AccountToUpdate"][];
        };
        /** @description Link/Unlink Advertising account or advertiser Response */
        UpdateAdvertisingAccountsInManagerAccountResponse: {
            /** @description List of Advertising accounts or advertisers failed to Link/Unlink with [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8). */
            failedAccounts?: components["schemas"]["AccountToUpdateFailure"][];
            /** @description List of Advertising accounts or advertisers successfully Link/Unlink with [Manager Account](https://advertising.amazon.com/help?ref_=a20m_us_blog_whtsnewfb2020_040120#GU3YDB26FR7XT3C8). */
            succeedAccounts?: components["schemas"]["AccountToUpdate"][];
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
    getManagerAccountsForUser: {
        parameters: {
            query?: never;
            header: {
                /** @description The identifier of a client associated with a "Login with Amazon" account. This is a required header for advertisers and integrators using the Advertising API. */
                "Amazon-Advertising-API-ClientId": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description **Success** - operation succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.getmanageraccountsresponse.v1+json": components["schemas"]["GetManagerAccountsResponse"];
                };
            };
            /** @description **Bad Request** - request failed because invalid parameters were provided. Ensure that all required parameters were provided. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description **Unauthorized** - request failed because user is not authenticated or is not allowed to invoke the operation. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description **Forbidden** - request failed because user does not have access to a specified resource */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description **Too Many Requests** - request was rate-limited. Retry later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description **Internal Service Error** - something failed in the server. Please try again later. If the issue persists, report an error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    createManagerAccount: {
        parameters: {
            query?: never;
            header: {
                /** @description The identifier of a client associated with a "Login with Amazon" account. This is a required header for advertisers and integrators using the Advertising API. */
                "Amazon-Advertising-API-ClientId": string;
            };
            path?: never;
            cookie?: never;
        };
        /** @description Request object required to create a new Manager account. */
        requestBody: {
            content: {
                "application/vnd.createmanageraccountrequest.v1+json": components["schemas"]["CreateManagerAccountRequest"];
            };
        };
        responses: {
            /** @description **Success** - operation succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.manageraccount.v1+json": components["schemas"]["ManagerAccount"];
                };
            };
            /** @description **Bad Request** - request failed because invalid parameters were provided. Ensure that all required parameters were provided. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.manageraccount.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Forbidden** - request failed because the caller was not authorized to create a Manager account. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.manageraccount.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Too Many Requests** - request was rate-limited. Retry later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.manageraccount.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Internal Service Error** - something failed in the server. Please try again later. If the issue persists, report an error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.manageraccount.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
        };
    };
    LinkAdvertisingAccountsToManagerAccountPublicAPI: {
        parameters: {
            query?: never;
            header: {
                /** @description The identifier of a client associated with a "Login with Amazon" account. This is a required header for advertisers and integrators using the Advertising API. */
                "Amazon-Advertising-API-ClientId": string;
            };
            path: {
                /** @description Id of the Manager Account. */
                managerAccountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/vnd.updateadvertisingaccountsinmanageraccountrequest.v1+json": components["schemas"]["UpdateAdvertisingAccountsInManagerAccountRequest"];
            };
        };
        responses: {
            /** @description **Multi-Status** - Some Advertising accounts or advertisers may not have been linked successfully. */
            207: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["UpdateAdvertisingAccountsInManagerAccountResponse"];
                };
            };
            /** @description **Bad Request** - request failed because invalid parameters were provided. Ensure that all required parameters were provided. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Unauthorized** - request failed because user is not authenticated or is not allowed to invoke the operation. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Forbidden** - request failed because user does not have access to a specified resource. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Too Many Requests** - request was rate-limited. Retry later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Internal Service Error** - something failed in the server. Please try again later. If the issue persists, report an error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
        };
    };
    UnlinkAdvertisingAccountsToManagerAccountPublicAPI: {
        parameters: {
            query?: never;
            header: {
                /** @description The identifier of a client associated with a "Login with Amazon" account. This is a required header for advertisers and integrators using the Advertising API. */
                "Amazon-Advertising-API-ClientId": string;
            };
            path: {
                /** @description Id of the Manager Account. */
                managerAccountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/vnd.updateadvertisingaccountsinmanageraccountrequest.v1+json": components["schemas"]["UpdateAdvertisingAccountsInManagerAccountRequest"];
            };
        };
        responses: {
            /** @description **Multi-Status** - Some Advertising accounts or advertisers may not have been linked successfully. */
            207: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["UpdateAdvertisingAccountsInManagerAccountResponse"];
                };
            };
            /** @description **Bad Request** - request failed because invalid parameters were provided. Ensure that all required parameters were provided. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Unauthorized** - request failed because user is not authenticated or is not allowed to invoke the operation. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Forbidden** - request failed because user does not have access to a specified resource. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Too Many Requests** - request was rate-limited. Retry later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description **Internal Service Error** - something failed in the server. Please try again later. If the issue persists, report an error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.updateadvertisingaccountsinmanageraccountresponse.v1+json": components["schemas"]["ErrorDetail"];
                };
            };
        };
    };
}
