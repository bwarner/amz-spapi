# SellAvant

An AI **Amazon seller assistant** — "Perplexity for Amazon ops." A conversational
console plus operations copilots for **Amazon SP‑API** and **Amazon Ads API**,
with listing/creative tooling (including an AI **A+ Content Studio**), email
triage, and profit/margin tracking.

Nx + TypeScript monorepo.

## Workspace layout

**apps/**

- `web/` — Next.js (App Router) app: dashboards, brand guides, and the A+ Content Studio.
- `spcli/` — operational CLI for the SP‑API.
- `adscli/` — operational CLI for the Ads API.

**packages/ & libs/**

- `amazon-sp-schema` / `amazon-ads-schema` — official API schemas (Swagger 2.0 / OpenAPI 3.0).
- `amazon-sp-generated` / `amazon-ads-generated` — generated TypeScript types.
- `sp-client` / `ad-client` — type‑safe HTTP clients with auto token refresh.
- `credential-store` — SQLite‑backed OAuth token storage.
- `oauth` — LWA (Login with Amazon) OAuth helpers.
- `models` — shared domain models + Zod schemas (incl. A+ content schemas).
- `ai-provider` — AI Gateway language + image provider.

## Quickstart

### Web app

```sh
npm install
npx nx serve web          # https://local.sellavant.com:9443
```

Copy `apps/web/.env.local.example` → `apps/web/.env.local` and fill in Auth0, the
AI Gateway key, Couchbase, AWS, and (optionally) PostHog values.

> **VSCode terminal note:** the integrated terminal exports
> `ELECTRON_RUN_AS_NODE=1`, which breaks some native installs/runs. Prefix with
> `env -u ELECTRON_RUN_AS_NODE` when installing deps or running the dev server,
> e.g. `env -u ELECTRON_RUN_AS_NODE npx nx serve web`.

### CLIs

```sh
# SP‑API
cd apps/spcli && cp config.toml.example config.toml   # add your LWA credentials
npx nx build spcli
./spcli.sh credentials add --refresh-token YOUR_TOKEN
./spcli.sh orders list --days 7

# Ads API
cd apps/adscli && cp config.toml.example config.toml
npx nx build adscli
```

## Common tasks

```sh
npx nx graph                      # explore the project graph
npx nx run-many -t test           # run tests
npx nx run-many -t lint           # lint
npx nx typecheck web              # (or: npx tsc -p apps/web/tsconfig.json --noEmit)
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) — architecture, conventions, and AI‑assistant guidance
- [A-PLUS.md](./A-PLUS.md) — A+ Content Studio: pipeline, modules, design styles, image generation, and the env/PostHog A/B switches
- [DESIGN.md](./DESIGN.md) — SellAvant design system (tokens, components)
- [CLI-USAGE.md](./CLI-USAGE.md) — `spcli` / `adscli` usage
- [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) — product roadmap
- [AGENTS.md](./AGENTS.md) — agent/automation guidance

## Tech stack

Next.js · TypeScript (strict) · Zod · Nx · Auth0 · Couchbase · AWS (S3, SAM) ·
Vercel · Vercel AI Gateway (Anthropic / OpenAI / image models).
