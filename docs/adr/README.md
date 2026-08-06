# Architecture Decision Records

Short records of significant, hard-to-reverse decisions and _why_ we made them.
One decision per file, numbered sequentially. Format: Context → Decision → Options
considered → Consequences. A decision is never edited to reverse it — instead a new
ADR supersedes it, and both link to each other.

Status values: **Proposed** → **Accepted** → **Superseded** (or **Rejected**).

Write one when a choice is expensive to undo, when two reasonable options were
weighed, or when the code will not explain itself later. The test: if someone
finds this decision in six months and asks "why is it like this?", is the answer
in the repository?

## Index

| #                                                                | Title                                                                                  | Status     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| [0001](0001-cdk-deploys-sam-is-local-invoke.md)                  | CDK deploys AWS infrastructure; SAM is used only for local invoke                      | Accepted   |
| [0002](0002-aws-account-topology.md)                             | A dedicated production account for SellAvant, and where the SES identity lives         | Accepted   |
| [0003](0003-dns-and-mail-routing.md)                             | Move DNS to Route 53, and split mail by name                                           | Proposed   |
| [0004](0004-database-structure.md)                               | Scopes are organisational; environments separate at the cluster boundary or not at all | Superseded |
| [0005](0005-environment-scopes.md)                               | One scope per environment, with a database user per scope                              | Accepted   |
| [0006](0006-lambda-images-are-content-addressed-assets.md)       | Container Lambdas are deployed as content-addressed CDK image assets                   | Accepted   |
| [0007](0007-page-shaped-endpoints-and-gateway-jwt-validation.md) | Private API endpoints are page-shaped, and the gateway validates the token             | Accepted   |
| [0008](0008-stored-bytes-are-retained-not-billed.md)             | Stored bytes are retained by policy, not metered for billing                           | Accepted   |
| [0009](0009-scheduling-and-notifications-live-on-aws.md)         | Scheduled sync and Amazon notifications run on AWS, not Vercel Cron                    | Accepted   |
| [0010](0010-lambdas-reach-couchbase-over-the-data-api.md)        | Lambdas reach Couchbase over the Data API, with the login fetched at runtime           | Accepted   |

Related epic: [#51 — AWS integration](https://github.com/bwarner/amz-spapi/issues/51)
