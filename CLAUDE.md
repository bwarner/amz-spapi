# CLAUDE.md

**Project:** Amazon Seller Assistant (working name)

**Role assumptions:**

- You (engineer) have 30+ years experience; strong in Node/TS/React/Nx; also Java/Rails/AWS.
- I’m acting as PM/co‑founder. This doc aligns Claude Code (and other AI copilots) with our product goals, architecture, and coding standards so it can reliably propose changes and generate code in this monorepo.

---

## 0) Vision & user value

A focused, seller‑oriented assistant that feels like **Perplexity for Amazon ops**, with deep integrations:

- **Conversational console** to ask questions, run playbooks, and generate assets (copy/images/A+).
- **Operations copilots** for **Amazon SP‑API** and **Amazon Ads API** (later Alibaba 1688/Logistics).
- **Campaign & listing optimization** (keywords, bids, A/B, A+ content, images), **returns/reviews triage** (via email ingest), and **profit/margin** tracking from supplier → 3PL → FBA.
- **Data views** (tables + charts) for campaigns, sales, shipments, profitability.

Non‑goals (v1): full multi‑tenant billing portal, advanced ML (we’ll prompt/chain tools first), mobile apps.

---

## 1) High‑level architecture

**Monorepo:** Nx + TypeScript

- **apps/**

  - **web/**: Next.js app (app router) — UI (Perplexity‑like) + dashboards.
  - **spcli/**: operational CLI SP API
  - **adscli/**: operational CLI ADS API

- **packages/**

  - **amazon-ads-schema/**: Amazon Ads API OpenAPI 3.0 schemas (JSON)
  - **amazon-ads-generated/**: Generated TypeScript types from Ads API schemas
  - **amazon-sp-schema/**: Amazon SP-API Swagger 2.0 schemas (Catalog, Orders)
  - **amazon-sp-generated/**: Generated TypeScript types (Swagger 2.0 → OpenAPI 3.0 → TS)
  - **ad-client/**: Type-safe HTTP client for Amazon Ads API with auto token refresh
  - **sp-client/**: Type-safe HTTP client for Amazon SP-API with auto token refresh
  - **credential-store/**: SQLite-based credential storage for OAuth tokens
  - **oauth/**: OAuth 2.0 flow helpers for LWA (Login with Amazon)
  - **models/**: Shared domain models and Zod schemas
  - **core/**: (planned) shared types, domain models, zod schemas
  - **db/**: (planned) Couchbase SDK wrappers, repository layer, migrations/DDL utilities
  - **aws/**: (planned) AWS helpers (Powertools, SQS/SNS/SES/Events wrappers, SigV4 utils if needed)
  - **ai/**: (planned) Claude invocation, prompt templates, tool schemas
  - **ui/**: (planned) shared React components (shadcn/ui + charts)

**Runtime & infra**

- **Frontend**: Next.js on **Vercel** (edge where possible; server actions hitting our AWS APIs).
- **Backend**: AWS **SAM** stacks for Lambdas, API Gateway (HTTP), SQS, EventBridge, SES inbound, S3, Secrets Manager, CloudFront for asset gen callbacks.
- **Data**: **Couchbase** Capella/CE — buckets for operational OLTP and vector search later (or external vec DB if needed).
- **Auth**: **Auth0** for app users; **LWA OAuth** for SP‑API and Ads OAuth for Ads API (separate).
- **Queues**: SQS for async jobs (email triage, image gen, SP‑API pulls, Ads syncs).
- **Observability**: Powertools (tracing/logging/metrics) + CloudWatch dashboards + Sentry/Logtail for web.

---

## 2) Key features & flows

### 2.1 Conversational UI (Perplexity‑like)

- Unified chat pane with sources on the right (citations, job runs, metrics).
- Tooling:

  - `spapi.query` (catalog/orders/listings/finance)
  - `ads.bidAdjust`, `ads.report`
  - `listing.generateAPlus`, `listing.imageGen`, `listing.copyOptimize`
  - `email.search`, `email.replyTemplate`, `returns.createCase`
  - `shipping.quote`, `alibaba.track`

- Each tool is a **server action → API route** that enqueues a job or calls an integration; UI polls or receives stream updates.

### 2.2 Amazon SP‑API

- Backend‑only. Store **LWA refresh token** encrypted (KMS). Cache access tokens (\~1h). Mint **RDT** for restricted calls. No SigV4 required (current guidance).
- Multi‑marketplace aware; seller can link multiple.

### 2.3 Amazon Advertising API

- Separate LWA client/app & scopes. Store **Ads refresh token** per advertiser profile. Require `profileId` header.

### 2.4 Email ingest → triage (returns/reviews)

- Route inbound via **SES Inbound** or forward from seller mailbox to SES. Lambda parses, classifies intent (return, review issue, shipment), links to order/customer via SP‑API, opens tasks.

### 2.5 Listing & creatives

- Prompt Claude for bullet points, titles, A+ modules. Image gen via image tool or external service; store assets in S3 and metadata in Couchbase.

### 2.6 Shipments & suppliers (Alibaba/3PL)

- Track POs from supplier → 3PL → Amazon FC. Status updates via email parsing + manual forms; later API integrations (AliExpress/1688 if viable).

### 2.7 Billing & margins

- Pull fees & payouts from SP‑API Finance; combine with COGS, freight, ads cost → margin dashboards.

---

## 3) API Type Generation & Client Architecture

### 3.1 Type-Safe API Clients

All external API integrations use **generated TypeScript types** for compile-time safety:

**Amazon Ads API (OpenAPI 3.0)**

- Source schemas in `amazon-ads-schema/src/assets/*.json`
- Generated types via `openapi-typescript` v7.8.0
- Output in `amazon-ads-generated/src/lib/*.ts`
- HTTP client: `ad-client` with auto token refresh

**Amazon SP-API (Swagger 2.0)**

- Source schemas in `amazon-sp-schema/src/assets/*.json`
- **Two-step generation**: Swagger 2.0 → OpenAPI 3.0 (via `swagger2openapi`) → TypeScript (via `openapi-typescript`)
- Output in `amazon-sp-generated/src/lib/*.ts`
- HTTP client: `sp-client` with auto token refresh, region-aware endpoints

**Implemented APIs:**

- SP-API Catalog Items (2022-04-01): `getCatalogItem()`, `searchCatalogItems()`
- SP-API Orders (v0): `getOrders()`, `getOrder()`, `getOrderItems()`

**To add a new API:**

1. Download official JSON schema from Amazon
2. Place in appropriate `-schema` package
3. Add to generator script in `-generated` package
4. Run generator to create TypeScript types
5. Add methods to HTTP client package using generated types

### 3.2 CLI Architecture (spcli / adscli)

Both CLIs follow Unix philosophy:

**Credential Management:**

- LWA OAuth credentials in `config.toml` (gitignored, use `config.toml.example`)
- Tokens stored in SQLite (`credential-store` package)
- Auto-refresh via request interceptors

**Pipeline-Friendly:**

- Read from stdin for batch operations
- Output formats: `json`, `table`, `csv`, custom
- Exit codes for error handling

**Example:**

```bash
# List orders, extract IDs, get details with items
./spcli.sh orders list --days 7 --format json | \
  jq -r '.[].orderId' | \
  ./spcli.sh orders get --include-items
```

---

## 4) Data model (Couchbase collections)

(To be defined as we implement backend storage)

---

## 5) Security & token management

- **Auth0** for app users; HTTP‑only session cookies.
- **SP‑API & Ads** refresh tokens stored encrypted (KMS) per seller/profile; access tokens cached in Redis/Dynamo or Couchbase with TTL.
- **RDT**: mint just‑in‑time; never persist.
- Secret storage: **AWS Secrets Manager** for client secrets; parameterized by env.

---

## 6) Environments

- **dev** (local + dev AWS)
- **staging** (preview stacks, Vercel preview)
- **prod** (prod AWS + Vercel)

Env vars sample (per app):

```
AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
LWA_CLIENT_ID, LWA_CLIENT_SECRET, ADS_CLIENT_ID, ADS_CLIENT_SECRET
COUCHBASE_CONNSTR, COUCHBASE_USERNAME, COUCHBASE_PASSWORD, COUCHBASE_BUCKET
AWS_REGION, SES_INBOUND_RULESET
BEDROCK/OPENAI/CLAUDE_KEYS (depending on provider)
```

---

## 7) Nx workspace layout & targets

**apps/web (Next.js)**

- `build`: `next build`
- `dev`: `next dev`
- `lint`, `test`: eslint/jest
- `e2e`: Playwright/Cypress (later)

**apps/api-services (SAM)**

- `build`: `sam build`
- `deploy`: `sam deploy --config-env <env>`
- `local`: `sam local start-api`

**apps/cli**

- `start`: ts-node/tsx entrypoints (`nx run cli:start -- <cmd>`)

**packages**

- `ad-models`: exported zod schemas/types
- `db`: Couchbase client, repositories, migrations
- `integrations`: spapi/adsapi/email modules
- `ai`: prompt templates, tool runners
- `ui`: shared UI primitives

Use `nx run-many -t test -p web api-services` in CI.

---

## 8) Claude usage guidelines (for Claude Code)

### 8.1 General Principles

- Prefer **TypeScript**; use **generated types** from OpenAPI/Swagger schemas for external APIs
- Validate all external payloads with **Zod v4** schemas
- Follow **conventional commits** (feat/fix/docs/refactor/chore)
- Keep unit tests with each package
- **Never commit secrets** - use `config.toml.example` templates only

### 8.2 Adding New SP-API or Ads API Endpoints

1. **Get the schema**: Download official JSON schema from Amazon Developer Portal
2. **Add to schema package**: Place in `amazon-sp-schema` or `amazon-ads-schema`
3. **Generate types**:
   - For SP-API (Swagger 2.0): Add to generator in `amazon-sp-generated/src/index.ts`
   - For Ads API (OpenAPI 3.0): Add to generator in `amazon-ads-generated/src/index.ts`
   - Run: `npx nx run amazon-sp-generated:generate` or similar
4. **Add client methods**:
   - Update `sp-client/src/lib/sp-client.ts` or `ad-client` with new methods
   - Use generated types for parameters and return values
   - Follow existing patterns for token management
5. **Add CLI commands**:
   - Add commands to `spcli` or `adscli`
   - Support pipeline mode (stdin/stdout)
   - Multiple output formats (json/table/csv)
6. **Test with real API**: Always test with actual Amazon API before committing

### 8.3 CLI Command Patterns

- **Pipeline-friendly**: Accept input from stdin, output to stdout
- **Format options**: `--format json|table|csv`
- **Filtering**: Use query parameters for server-side filtering
- **Batch operations**: Support reading multiple IDs from stdin
- **Error handling**: Graceful degradation, continue on partial failures
- **Help text**: Clear examples in `--help` output

### 8.4 Web Integration (Future)

When adding endpoints for web app:

1. Create domain types in `packages/core`
2. Implement repo in `packages/db` with **idempotent** writes
3. Code used in Lambdas in `apps/api-services` using Powertools middlewares (tracing/logging/metrics)
4. Wire Next.js API route / server action in `apps/web`
5. For long-running tasks: enqueue SQS job; return job id; stream status to UI

### 8.5 Security Best Practices

- Store LWA credentials in `config.toml` (gitignored)
- Store tokens in SQLite (`credential-store`) with encryption
- Auto-refresh access tokens via HTTP interceptors
- Never log or expose refresh tokens
- Use environment-specific client IDs/secrets

Prompt template (example):

```
You are contributing to the Seller Assistant monorepo. Change scope: <package/app>.
Follow CLAUDE.md architecture. Use TypeScript, Zod v4, Powertools.
Implement: <feature>. Provide updated files and Nx target updates.
```

---

## 9) Coding standards

- **TypeScript** strict, ES2022.
- **Lints**: eslint + @typescript-eslint + import/order.
- **Tests**: jest + ts-jest; integration tests for Lambdas with `sam local` where feasible.
- **Runtime checks**: Zod parse at boundaries.
- **Logging**: Powertools Logger; no `console.log` in prod code.
- **Metrics**: Powertools Metrics (namespace `SellerOps`).
- **Tracing**: Powertools Tracer; wrap AWS SDK v3 with `captureAWSv3Client`.
- **Error handling**: never swallow errors in batch; use SQS partial failure mapping.

---

## 10) Deployment

- **Web**: Vercel → env‑per‑branch previews; custom domain on prod.
- **API**: SAM per env; pipeline stages dev→staging→prod. Use CodeDeploy for canary on critical Lambdas if needed.
- **Secrets**: injected from AWS Secrets Manager (SAM parameters) and Vercel project secrets.
- **CLIs**: Distributed as compiled binaries or via npm packages (future)

---

## 11) Observability & ops

- CloudWatch logs, metrics dashboards (errors, latency, SQS age, email backlog, SP‑API error rates).
- Sentry for web errors.
- Alerting via SNS/Slack (dead‑letter queues non‑empty, elevated 5xx, auth revocations).
- CLI: Pino structured logging with configurable levels

---

## 12) Roadmap (13‑week MVP plan)

**W1‑2** Foundations

- Nx monorepo hardening, env config, Couchbase conn & repo scaffolding.
- Auth0 login; basic user/tenant model.

**W3‑4** SP‑API connect & data pulls

- LWA connect flow; store refresh token.
- Pull catalog & orders nightly; simple dashboard.

**W5‑6** Conversational UI + tools v1

- Chat UI (Perplexity style) with tool calls for catalog lookup, order lookup.
- Image/A+ generation stubs.

**W7‑8** Email ingest & triage

- SES inbound → Lambda → queue → classify; link to orders; basic reply templates.

**W9‑10** Ads API connect & read‑only reports

- Ads OAuth; profile pick; pull spend & performance; simple charts.

**W11‑12** Profit & shipment tracking

- Combine fees/payouts/ads/COGS → margin view.
- Supplier/PO/shipment tracking basics.

**W13** Hardening & preview release

- RBAC, rate limits, error budgets, docs.

---

## 13) Acceptance criteria (MVP)

- Users can log in (Auth0) and **connect Amazon** (SP‑API) successfully.
- Chat UI can answer: _“What were my top 10 SKUs last week?”_ with sources.
- Email forwarding creates triaged tasks with linked orders.
- Ads connection shows campaign spend/ACOS last 7/30 days.
- Margin dashboard computes per‑SKU margin from fees + ads + COGS.
- All external payloads validated with Zod; 95% unit test coverage on integrations.

---

## 14) Local dev quickstart

**Web/API:**

```bash
npm install
npx nx graph
npx nx run web:dev
npx nx run api-services:local
# Set COUCHBASE_*, AUTH0_*, LWA_*, ADS_* envs in .env.local
```

**CLIs:**

```bash
# SP-API CLI
cd apps/spcli
cp config.toml.example config.toml
# Edit config.toml with your LWA credentials
npx nx build spcli
./spcli.sh credentials add --refresh-token YOUR_TOKEN
./spcli.sh orders list --days 7

# Ads API CLI
cd apps/adscli
cp config.toml.example config.toml
# Edit config.toml with your LWA Ads credentials
npx nx build adscli
./adscli.sh credentials add --refresh-token YOUR_TOKEN
```

---

## 15) Open questions / risks

- Alibaba official APIs & stability.
- SP‑API/Ads rate limits & quotas → need backoff + job scheduling.
- Cost controls on image generation.
- Multi‑tenant isolation model (RBAC, data partitioning).

---

**Use this CLAUDE.md as the source of truth** when asking AI to write code, scaffolds, or refactors. Keep it updated as architecture evolves.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
