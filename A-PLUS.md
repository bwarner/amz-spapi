# A+ Content Studio

AI generator for Amazon **A+ Content** packages: it turns messy product inputs +
a brand guide into a buyer‑facing module stack with copy, designed layouts,
generated imagery, and a Seller Central build sheet. Output is previewed live and
exported as per‑module PNGs the seller uploads into Seller Central.

## Routes

The studio is a traditional list → editor flow under `apps/web/src/app/(dashboard)/a-plus/`:

| Route               | File                                      | Purpose                                             |
| ------------------- | ----------------------------------------- | --------------------------------------------------- |
| `/a-plus`           | `page.tsx` (server) → `designs-list.tsx`  | Paginated **designs list** — create / edit / delete |
| `/a-plus/new`       | `new/page.tsx` → `aplus-editor.tsx`       | Editor for a **new** design                         |
| `/a-plus/[draftId]` | `[draftId]/page.tsx` → `aplus-editor.tsx` | Editor for an **existing** design                   |

`aplus-editor.tsx` is the large client editor (renamed from the old `page.tsx`);
the route files are thin wrappers. Drafts persist via `/api/a-plus/drafts`
(`lib/a-plus-drafts.ts`, Couchbase). The nav "A+ Content" link points at `/a-plus`.

## Generation pipeline (`/api/a-plus/generate`)

Streams NDJSON events (`start`, `phase`, `module-done`, `phase-done`, `final`,
`error`). Stages:

1. **Strategy** — 1 LLM call. Plans the **complete, product‑tailored, dynamically
   ordered** module sequence (the structure adapts per product; not a fixed
   template). Module types are constrained to the canonical `RENDERABLE_AMAZON_MODULE_TYPES`.
2. **Package outer** — the **deterministic planner** (`buildPackageOuterFromStrategy`,
   no LLM) by default; pads/dedupes the plan by layout kind and rotates the
   fallback order per product. Set `A_PLUS_USE_AI_PACKAGE_PLANNER=true` for an
   extra AI planning call instead.
3. **Modules** — writes the actual module content. **A/B switchable** (see below):
   - `single` (default) — **one** LLM call writes the whole package (tighter
     coherence, fewer requests).
   - `parallel` — **one call per module**, run concurrently (resilient, streams
     per‑module progress). Each retried once on schema failure.
4. **Images** — only eager‑generated here if `A_PLUS_GENERATE_IMAGES=true` (first
   slot of the first 2 modules). Normally images are filled later via the UI
   "Generate all images" button → `/api/a-plus/image-generate`.

**Module count:** Basic A+ = 5, Premium A+ = 7 (`clampModuleCount`).

The `final` event's `payload.runConfig` reports `{ generationMode, imageVariant, model }`
— shown in the UI under **Package rationale** as `Mode:` / `Image:` badges.

### Image cohesion

Every image brief receives a shared **"shot bible"** continuity block (same
product, same lighting / palette / lens / mood) so the page reads as one shoot.

## Module types & design

Schemas live in `packages/models/src/lib/aplus.ts` (`APlusGeneratedModuleSchema`).
Kinds: `company-logo`, `image-header-with-text`, `image-text-overlay`,
`single-image-text`, `image-and-text`, `three-image-text`,
`four-image-text-quadrant`, `comparison-table`, `tech-specs`, `text-only`,
`dual-use-split`.

Rendering is in `components/a-plus-design.tsx` (`DesignedModule`) — **pure,
satori‑safe** components shared by the on‑screen preview
(`a-plus-design-preview.tsx`) and the PNG export, so they render identically.

Notable modules:

- **company-logo** → a **brand hero**: ambient AI backdrop slot + brand‑tinted
  scrim + the seller's real (uploaded) logo + accent + tagline. The logo is never
  AI‑generated; only the backdrop is.
- **hero** modules support an optional **spec badge** (e.g. "16 OZ") overlaid.
- **dual-use-split** → two labeled scenario panels (e.g. Hot vs Cold).

### Design styles (skin **and** structure)

A `Style` dropdown (Generate Package card) picks one of: **Editorial / Modern
Clean / Bold Commerce / Minimal**. Style sits **above** the layout — it drives
both the skin (fonts, palette, section titles, bullets, radius) **and**
composition via structural tokens on `BrandTheme`:

- `heroLayout` (`split` | `stacked`), `contentAlign`, `imageSide`
  (`left`/`right`/`alternate`), `imageBleed`, `density` (`airy`/`normal`/`tight`).

So Editorial = stacked/centered, Modern = split with right‑edge bleed, Bold =
alternating edge‑to‑edge, Minimal = airy single column. The hero, 3‑image grid,
and tech‑specs all compose per style. The style flows into the PNG export via the
theme body (`module-image` route), so downloads match the preview.

## Image generation

- **Per‑slot**, via `/api/a-plus/image-generate` (the UI "Generate all images" /
  per‑image "Regenerate" buttons). Fast: ~8–12s/image.
- Driven by `libs/ai-provider` `generateImage` through the **AI Gateway**.
- **A/B switchable backend** (see config): `openai/gpt-image-1` (default),
  `google/imagen-4.0`, or `xai/grok-imagine-image`.
- Generated images are persisted to **S3** (`lib/media-assets.ts`) and referenced
  by `/api/a-plus/assets/<id>`. **If S3 upload fails** (e.g. expired AWS SSO) the
  route returns a base64 data URL with `persistError`; the UI shows a red warning
  and **never writes base64 into the draft** (would exceed the 10MB body limit).

## Generation model selector

A **Generation model** dropdown (Generate Package card) picks the LLM for
strategy + modules from a server‑validated allowlist (`APLUS_GENERATION_MODELS`):
Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.8 and GPT‑5.4 mini / 5.4 / 5.5. Sent as
`model` in the generate request; an invalid id falls back to the server default.
All models route through the **AI Gateway** (no Bedrock).

## Configuration

Each A/B behavior resolves in this precedence: **env override → PostHog flag →
default** (`lib/image-model-flag.ts`).

| Setting           | Env override                                      | PostHog flag            | Default  |
| ----------------- | ------------------------------------------------- | ----------------------- | -------- |
| Module generation | `A_PLUS_GENERATION_MODE` = `single`/`parallel`    | `aplus-generation-mode` | `single` |
| Image backend     | `A_PLUS_IMAGE_VARIANT` = `openai`/`google`/`grok` | `aplus-image-model`     | `openai` |

Other env knobs (`apps/web/.env.local.example`):

- `A_PLUS_IMAGE_QUALITY` — gpt-image-1 quality (`low`/`medium`/`high`).
- `A_PLUS_IMAGE_MODEL_{OPENAI,GOOGLE,GROK}` — override the gateway slug per variant.
- `A_PLUS_GENERATE_IMAGES=true` — eager image gen during the generate call (off by default).
- `A_PLUS_USE_AI_PACKAGE_PLANNER=true` — AI package planner instead of deterministic.
- `AI_GATEWAY_API_KEY` (required for gateway), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` — enable the flags + client analytics.
- `MEDIA_ASSETS_BUCKET`, `AWS_REGION`, `AWS_PROFILE` — S3 asset storage.

**Local dev note:** the VSCode terminal exports `ELECTRON_RUN_AS_NODE=1`, which
breaks some native installs/runs — prefix with `env -u ELECTRON_RUN_AS_NODE` when
installing or running outside the dev server.

## Export (PNG)

`/api/a-plus/module-image` renders one module to a PNG via `next/og` (satori).
It inlines S3 assets as data URLs, **rasterizes SVG logos via sharp** (satori's
native SVG handling is unreliable), and sizes each module with `estimateHeight`
(content‑/style‑aware). The brand logo + style + spec badge all carry into the
export.

## Brand guides (`/brand-guides`)

Reusable logo / colors / fonts / voice, stored per user. The selected guide's
`logoAsset`, palette, and fonts feed `brandThemeFrom(...)` in the editor. Upload
the logo here (SVG or raster) and apply the guide in the A+ builder for it to
appear in the company-logo hero + lockups.

## Key files

- `apps/web/src/app/(dashboard)/a-plus/` — routes, `aplus-editor.tsx`, `designs-list.tsx`, `components/`
- `apps/web/src/app/api/a-plus/` — `generate`, `image-generate`, `module-image`, `drafts`, `brand-guides`, `assets`
- `apps/web/src/lib/` — `image-model-flag.ts` (flag/override resolvers), `a-plus-drafts.ts`, `media-assets.ts`
- `packages/models/src/lib/aplus.ts` — schemas, module kinds, type maps, model allowlist, guardrails
- `libs/ai-provider/` — gateway language + image provider
