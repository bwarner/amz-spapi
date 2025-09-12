# CLAUDE.md

**Project:** Amazon Seller Assistant (working name)

**Role assumptions:**

* You (engineer) have 30+ years experience; strong in Node/TS/React/Nx; also Java/Rails/AWS.
* I’m acting as PM/co‑founder. This doc aligns Claude Code (and other AI copilots) with our product goals, architecture, and coding standards so it can reliably propose changes and generate code in this monorepo.

---

## 0) Vision & user value

A focused, seller‑oriented assistant that feels like **Perplexity for Amazon ops**, with deep integrations:

* **Conversational console** to ask questions, run playbooks, and generate assets (copy/images/A+).
* **Operations copilots** for **Amazon SP‑API** and **Amazon Ads API** (later Alibaba 1688/Logistics).
* **Campaign & listing optimization** (keywords, bids, A/B, A+ content, images), **returns/reviews triage** (via email ingest), and **profit/margin** tracking from supplier → 3PL → FBA.
* **Data views** (tables + charts) for campaigns, sales, shipments, profitability.

Non‑goals (v1): full multi‑tenant billing portal, advanced ML (we’ll prompt/chain tools first), mobile apps.

---

## 1) High‑level architecture

**Monorepo:** Nx + TypeScript

* **apps/**

  * **web/**: Next.js app (app router) — UI (Perplexity‑like) + dashboards.
  * **spcli/**: operational CLI SP API
  * **adscli/**: operational CLI ADS API 
* **packages/**

  * **core/**: shared types, domain models, zod schemas.
  * **ad-models/**: domain models, zod schemas.
  * **db/**: Couchbase SDK wrappers, repository layer, migrations/DDL utilities.
  * **aws/**: AWS helpers (Powertools, SQS/SNS/SES/Events wrappers, SigV4 utils if needed).
  * **integrations/**: spapi, adsapi, alibaba, email (IMAP/SES), stripe/billing helper.
  * **ai/**: Claude invocation, prompt templates, tool schemas.
  * **ui/**: shared React components (shadcn/ui + charts).

**Runtime & infra**

* **Frontend**: Next.js on **Vercel** (edge where possible; server actions hitting our AWS APIs).
* **Backend**: AWS **SAM** stacks for Lambdas, API Gateway (HTTP), SQS, EventBridge, SES inbound, S3, Secrets Manager, CloudFront for asset gen callbacks.
* **Data**: **Couchbase** Capella/CE — buckets for operational OLTP and vector search later (or external vec DB if needed).
* **Auth**: **Auth0** for app users; **LWA OAuth** for SP‑API and Ads OAuth for Ads API (separate).
* **Queues**: SQS for async jobs (email triage, image gen, SP‑API pulls, Ads syncs).
* **Observability**: Powertools (tracing/logging/metrics) + CloudWatch dashboards + Sentry/Logtail for web.

---

## 2) Key features & flows

### 2.1 Conversational UI (Perplexity‑like)

* Unified chat pane with sources on the right (citations, job runs, metrics).
* Tooling:

  * `spapi.query` (catalog/orders/listings/finance)
  * `ads.bidAdjust`, `ads.report`
  * `listing.generateAPlus`, `listing.imageGen`, `listing.copyOptimize`
  * `email.search`, `email.replyTemplate`, `returns.createCase`
  * `shipping.quote`, `alibaba.track`
* Each tool is a **server action → API route** that enqueues a job or calls an integration; UI polls or receives stream updates.

### 2.2 Amazon SP‑API

* Backend‑only. Store **LWA refresh token** encrypted (KMS). Cache access tokens (\~1h). Mint **RDT** for restricted calls. No SigV4 required (current guidance).
* Multi‑marketplace aware; seller can link multiple.

### 2.3 Amazon Advertising API

* Separate LWA client/app & scopes. Store **Ads refresh token** per advertiser profile. Require `profileId` header.

### 2.4 Email ingest → triage (returns/reviews)

* Route inbound via **SES Inbound** or forward from seller mailbox to SES. Lambda parses, classifies intent (return, review issue, shipment), links to order/customer via SP‑API, opens tasks.

### 2.5 Listing & creatives

* Prompt Claude for bullet points, titles, A+ modules. Image gen via image tool or external service; store assets in S3 and metadata in Couchbase.

### 2.6 Shipments & suppliers (Alibaba/3PL)

* Track POs from supplier → 3PL → Amazon FC. Status updates via email parsing + manual forms; later API integrations (AliExpress/1688 if viable).

### 2.7 Billing & margins

* Pull fees & payouts from SP‑API Finance; combine with COGS, freight, ads cost → margin dashboards.

---

## 3) Data model (Couchbase collections)


## 4) Security & token management

* **Auth0** for app users; HTTP‑only session cookies.
* **SP‑API & Ads** refresh tokens stored encrypted (KMS) per seller/profile; access tokens cached in Redis/Dynamo or Couchbase with TTL.
* **RDT**: mint just‑in‑time; never persist.
* Secret storage: **AWS Secrets Manager** for client secrets; parameterized by env.

---

## 5) Environments

* **dev** (local + dev AWS)
* **staging** (preview stacks, Vercel preview)
* **prod** (prod AWS + Vercel)

Env vars sample (per app):

```
AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
LWA_CLIENT_ID, LWA_CLIENT_SECRET, ADS_CLIENT_ID, ADS_CLIENT_SECRET
COUCHBASE_CONNSTR, COUCHBASE_USERNAME, COUCHBASE_PASSWORD, COUCHBASE_BUCKET
AWS_REGION, SES_INBOUND_RULESET
BEDROCK/OPENAI/CLAUDE_KEYS (depending on provider)
```

---

## 6) Nx workspace layout & targets

**apps/web (Next.js)**

* `build`: `next build`
* `dev`: `next dev`
* `lint`, `test`: eslint/jest
* `e2e`: Playwright/Cypress (later)

**apps/api-services (SAM)**

* `build`: `sam build`
* `deploy`: `sam deploy --config-env <env>`
* `local`: `sam local start-api`

**apps/cli**

* `start`: ts-node/tsx entrypoints (`nx run cli:start -- <cmd>`)

**packages**

* `ad-models`: exported zod schemas/types
* `db`: Couchbase client, repositories, migrations
* `integrations`: spapi/adsapi/email modules
* `ai`: prompt templates, tool runners
* `ui`: shared UI primitives

Use `nx run-many -t test -p web api-services` in CI.

---

## 7) Claude usage guidelines (for Claude Code)

* Prefer **TypeScript**; generate **Zod v4** schemas for DTOs; validate all external payloads.
* When adding endpoints:

  1. Update **domain types** in `packages/core`.
  2. Implement repo in `packages/db` with **idempotent** writes.
  3. code used in Lambdas in `apps/api-services` using Powertools middlewares (tracing/logging/metrics) and SQS partial failure when batch processing.
  4. Add client in `packages/integrations` that wraps auth, caching, and rate limits.
  5. Wire Next.js API route / server action in `apps/web` that calls our AWS API.
* For long‑running tasks: enqueue SQS job; return job id; stream status to UI.
* For image/A+ generation: write asset to S3; store doc in `catalog.images` or `catalog.a_plus_modules`; return signed URL to web.
* For emails: normalize into `ops.email_messages`, run classifiers, open `ops.jobs`/`orders.returns` as needed.
* Follow **conventional commits** and keep unit tests with each package.

Prompt template (example):

```
You are contributing to the Seller Assistant monorepo. Change scope: <package/app>.
Follow CLAUDE.md architecture. Use TypeScript, Zod v4, Powertools.
Implement: <feature>. Provide updated files and Nx target updates.
```

---

## 8) Coding standards

* **TypeScript** strict, ES2022.
* **Lints**: eslint + @typescript-eslint + import/order.
* **Tests**: jest + ts-jest; integration tests for Lambdas with `sam local` where feasible.
* **Runtime checks**: Zod parse at boundaries.
* **Logging**: Powertools Logger; no `console.log` in prod code.
* **Metrics**: Powertools Metrics (namespace `SellerOps`).
* **Tracing**: Powertools Tracer; wrap AWS SDK v3 with `captureAWSv3Client`.
* **Error handling**: never swallow errors in batch; use SQS partial failure mapping.

---

## 9) Deployment

* **Web**: Vercel → env‑per‑branch previews; custom domain on prod.
* **API**: SAM per env; pipeline stages dev→staging→prod. Use CodeDeploy for canary on critical Lambdas if needed.
* **Secrets**: injected from AWS Secrets Manager (SAM parameters) and Vercel project secrets.

---

## 10) Observability & ops

* CloudWatch logs, metrics dashboards (errors, latency, SQS age, email backlog, SP‑API error rates).
* Sentry for web errors.
* Alerting via SNS/Slack (dead‑letter queues non‑empty, elevated 5xx, auth revocations).

---

## 11) Roadmap (13‑week MVP plan)

**W1‑2** Foundations

* Nx monorepo hardening, env config, Couchbase conn & repo scaffolding.
* Auth0 login; basic user/tenant model.

**W3‑4** SP‑API connect & data pulls

* LWA connect flow; store refresh token.
* Pull catalog & orders nightly; simple dashboard.

**W5‑6** Conversational UI + tools v1

* Chat UI (Perplexity style) with tool calls for catalog lookup, order lookup.
* Image/A+ generation stubs.

**W7‑8** Email ingest & triage

* SES inbound → Lambda → queue → classify; link to orders; basic reply templates.

**W9‑10** Ads API connect & read‑only reports

* Ads OAuth; profile pick; pull spend & performance; simple charts.

**W11‑12** Profit & shipment tracking

* Combine fees/payouts/ads/COGS → margin view.
* Supplier/PO/shipment tracking basics.

**W13** Hardening & preview release

* RBAC, rate limits, error budgets, docs.

---

## 12) Acceptance criteria (MVP)

* Users can log in (Auth0) and **connect Amazon** (SP‑API) successfully.
* Chat UI can answer: *“What were my top 10 SKUs last week?”* with sources.
* Email forwarding creates triaged tasks with linked orders.
* Ads connection shows campaign spend/ACOS last 7/30 days.
* Margin dashboard computes per‑SKU margin from fees + ads + COGS.
* All external payloads validated with Zod; 95% unit test coverage on integrations.

---

## 13) Local dev quickstart

```bash
pnpm i
pnpm nx graph
pnpm nx run web:dev
pnpm nx run api-services:local
# Set COUCHBASE_*, AUTH0_*, LWA_*, ADS_* envs in .env.local
```

---

## 14) Open questions / risks

* Alibaba official APIs & stability.
* SP‑API/Ads rate limits & quotas → need backoff + job scheduling.
* Cost controls on image generation.
* Multi‑tenant isolation model (RBAC, data partitioning).

---

**Use this CLAUDE.md as the source of truth** when asking AI to write code, scaffolds, or refactors. Keep it updated as architecture evolves.
