# Amazon Content Platform — Redesign Proposal

> Living design doc. Phase 1 = A+ Content Builder, architected so Brand Story,
> Product Listings, and future formats are added later as _deployment compilers_
> over a shared platform — not rewrites.

## Central reframe

The current system is **module-first**: the strategy plans against
`RENDERABLE_AMAZON_MODULE_TYPES`, generates copy + image briefs _per module_, and
renders each module as an isolated Satori design. Amazon's module taxonomy drives
the creative.

**Invert it.** Amazon modules are a _deployment target_, not a design canvas. The
unit of work becomes an **Experience** — a conversion-driven visual narrative of
**Sections**, each with one job — and a **Deployment Compiler** slices it into
Amazon modules at the end. Strategy + Narrative + Visual become format-agnostic
platform services; only the compiler is format-specific. That boundary is the
whole bet: it makes A+ better _now_ and unlocks Brand Story / Listings _later_.

---

## 1. Current system assessment

**Retain (real moat):** AI Gateway model adapter · SP-API Catalog extraction ·
brand guides · drafts (Couchbase) · S3 asset pipeline (dedup + vision-describe) ·
compliance guardrails (no price/time-sensitive claims, competitor-contamination
prevention, photorealism, no-text-in-image) · shot-bible visual continuity ·
Satori render-to-PNG (as the module export renderer).

**Weaknesses (redesign targets):** module-first ideation · per-slot image gen
from text-only briefs (generic images, real photos unused) · copy not disciplined
for scanning · mobile = resize, not composition · assets are reference-only ·
everything A+-module-shaped (no Brand Story/Listing model) · no conversion
feedback loop · Satori's low design ceiling for compelling scenes.

**Risks:** Amazon moderation, SP-API limits/RDT, image-gen cost at scale,
structured-output fragility across models.

**Opportunities:** SP-API catalog + vision + reference-image gen = real product
fidelity; the layered separation is half-built; strategy/narrative reuse straight
into Listings + Brand Story.

---

## 2. Future-state vision

A **content operating system**: input a product → research it (catalog + reviews

- competitors) → persistent Product & Brand Intelligence → conversion-optimized
  **narrative** → **scenes in desktop _and_ mobile** → **compile** to any Amazon
  format → export-ready artifacts → (later) measure & learn. The seller curates a
  narrative; the platform handles formats.

---

## 3. Architecture — shared platform services

1. **Product & Market Intelligence** — facts, JTBD, objections, differentiators
   from **pluggable Intelligence Providers** (mirrors Asset Providers). The
   listing/ASIN may **not exist yet** (new listing, Brand Story), so catalog is a
   _preferred-when-available_ source, **never required**:

   - `CatalogSource` (SP-API) — authoritative, only when an ASIN exists.
   - `WebSource` — scrape supplier/1688/brand-site/competitor pages.
   - `AssetSource` — vision + doc extraction from uploaded photos, packaging,
     spec sheets, supplier PDFs.
   - `ManualSource` — seller-entered facts / brief.
   - `ReviewSource` — review mining (existing listings only).

   Every fact carries **provenance + confidence**; the engine works with whatever
   is available and **flags gaps** (reuse the current `missingFacts` —
   "proceed with assumption" vs "needs input"). Brand Story may be **product-less**
   (brand/collection intelligence, not a single ASIN). Initial-listing creation is
   partly a **reverse flow**: raw seller inputs/assets → the platform _generates_
   the listing (title/bullets/description/image strategy), which can then seed the
   catalog.

2. **Brand Intelligence** — voice, palette, logo, visual system.
3. **Strategy Engine** — personas, positioning, benefit hierarchy, objection map,
   differentiation.
4. **Narrative Engine** — strategy → ordered Sections, each tagged with a
   conversion job. _Format-agnostic._
5. **Visual Concept Engine** — Section → designed scene (art direction, layout,
   scannable copy, image plan) with **separate desktop + mobile** compositions.
6. **Asset Studio** — pluggable providers, vision profiling, matcher, generation
   (text-to-image + reference/image-to-image). _(See §3a.)_
7. **Deployment Compilers** — per-format adapters: pack scenes into A+ / Premium /
   Brand Story / Listing artifacts + validate.
8. **Render & Export** — scenes → PNG slices per module + Seller Central build
   sheets. (Satori lives here.)
9. **Governance** — compliance + brand + accessibility rules.
10. **Measurement (later)** — performance, A/B, feedback into Strategy.

Services 1–6 + 9 are **platform**; service 7 (+ parts of 8) are **format-specific**.

---

## 3a. Asset Studio (detailed)

Stop treating an upload as "a blob + a caption." Treat every asset as a **typed,
profiled input** matched to **declared scene needs**.

### Media, not just images

An asset is **media: image OR video**. Everything below (providers, profiling,
matcher) applies to both; video adds duration/audio/poster-frame fields. Video is
Premium-A+ / listing only (see graceful degradation, §4).

### Pluggable Asset Providers

All sources flow through the _same_ profiling + matcher:

- `Upload` — seller files (images **and** video).
- `UGC` — customer/creator clips the seller owns or has licensed; carries
  consent/licensing metadata + an `authentic` flag (high trust). A flavor of
  Upload, sourced from reviews/social with rights captured.
- `SP-API Catalog` — official Amazon product images (auto-imported).
- `Generated` — text-to-image / reference-image **and** generated video (gateway
  video models). _Caveat:_ generated video is reliable for ambient/B-roll/lifestyle
  motion, NOT for product-accurate hero footage — show the real product via UGC or
  uploaded footage, same authenticity rule as images.
- `Stock` (optional, secondary) — Unsplash/Pexels (images) + Pexels (video) via
  **official APIs only**.

### Profile on ingest (vision → structure, not just a caption)

```
AssetProfile {
  role: 'product-iso' | 'product-in-scene' | 'background' | 'detail-macro'
      | 'diagram' | 'logo' | 'person'
  subjectPresent: boolean
  subjectProminence: 'hero' | 'soft' | 'absent'
  orientation: 'portrait' | 'landscape' | 'square'
  subjectPosition: 'left' | 'right' | 'center'
  negativeSpace: { side: 'left'|'right'|'top'|'bottom'|'none', amount: 'low'|'med'|'high' }
  background: 'white' | 'transparent' | 'plain' | 'busy' | 'real-environment'
  affordances: Array<'hero-bg'|'carousel-tile'|'feature-callout'|'comparison-thumb'|'backdrop-layer'|'reference-only'>
  quality: { width, height, hasBakedText: boolean, isRender: boolean }
  dominantColors: string[]
  description: string   // human-readable summary (the vision-describe output)
}
```

### Match at design time (intent-based)

Each scene image slot declares an **ImageIntent**; a matcher scores every asset's
profile against it (affordance → composition → subject → color/brand → quality
gate) and resolves how it's filled:

- **product-iso** → place in comparison thumb / carousel tile, **or** use as the
  product **reference** for image-to-image.
- **product-in-scene** → place directly into a hero/full-image slot.
- **background** → backdrop layer; copy + real product composited on top.
- **detail-macro** → feature callout / icon-row image.
- **hasBakedText render** → unusable for direct placement (Amazon), usable as a
  generation reference.

**Transparent + overridable:** show each asset's detected role and where it's used;
let the seller pin/exclude/correct. Sellers know their catalog.

### Stock photos — verdict

Yes, but **secondary**. Generation is primary (bespoke, brand-consistent,
_differentiating_; generic stock undercuts the differentiation goal). Stock is a
fast-path for **backgrounds/props/textures** and as **reference fuel** — never for
the product itself or misleading usage shots. Guardrails: official APIs only,
clear commercial license (mind Unsplash/Pexels "no unaltered redistribution / no
competing service" clauses), and Amazon authenticity (A+ must represent the real
product). It's a small add _because_ it's just another Asset Provider.

---

## 4. Data models (Experience / Section / VisualConcept) — IN PROGRESS

> This is the abstraction everything else compiles from. Draft below; open
> decisions at the end.

```
// NOTE: productId is OPTIONAL. Brand Story can be product-less; an initial
// listing has no ASIN/catalog yet. Engines operate on whatever ProductIntelligence
// exists (possibly only ManualSource/AssetSource), surface `missingFacts`, and
// proceed with flagged assumptions — they never hard-require catalog data.
Experience {                 // a complete, format-agnostic narrative
  id
  productId?                 // → ProductIntelligence (optional; absent for Brand Story / pre-listing)
  brandId                    // → BrandProfile (always present; can stand alone)
  strategyId                 // → Strategy (personas/benefits/objections/voice)
  title
  goal                       // overall conversion goal
  primaryPersona
  artDirection: ArtDirection // inherited shot-bible: product look, palette, lighting, lens, mood
  sections: Section[]        // ordered narrative
  status: 'draft'|'ready'|'deployed'
}

Section {                    // one beat of the story; one job
  id
  order
  job: ConversionJob         // hook|problem|benefit|differentiation|proof|how-it-works|comparison|brand|cta
  intent                     // 1 sentence: what this section must accomplish
  headline                   // scannable, hard word cap
  subcopy?                   // short
  bullets?                   // scannable
  proofPoints?               // ratings/specs/certs referenced here
  visual: VisualConcept
  locked: boolean            // seller-locked → don't regenerate
  notes?                     // seller direction
}

VisualConcept {
  medium: 'static' | 'hotspots' | 'video'   // FIRST-CLASS — see degradation below
  layout: LayoutIntent       // archetype, DECOUPLED from Amazon module names
  desktop: Composition
  mobile: Composition        // separately composed, NOT a resize
  images: ImageSlot[]
  hotspots?: Hotspot[]       // when medium = 'hotspots'
  video?: VideoSlot          // when medium = 'video'
}

Hotspot {                    // anchored callout on a base image (Premium A+)
  position: { x, y }         // normalized 0..1 on the base image
  label                      // short
  copy                       // 1–2 lines revealed on hover/tap
}

VideoSlot {
  intent                     // what the video must show + duration target
  source: MediaSourceDecision  // ugc | uploaded | generated | stock
  posterFrame: ImageSlot     // REQUIRED — the static fallback (see degradation)
  captions?                  // for sound-off viewing (most Amazon video autoplays muted)
}

Composition {
  aspect                     // target aspect for this surface
  focalHierarchy[]           // what the eye hits 1st/2nd/3rd
  textZones[]                // reserved legible regions
  copyPlacement              // headline/subcopy/bullets vs imagery + negative space
}

ImageSlot {
  role                       // hero-bg|product-iso|lifestyle|detail|background|comparison-thumb...
  intent: ImageIntent
  source: ImageSourceDecision  // resolved by the Asset Studio matcher
  alt
}

ImageIntent {
  subject                    // product|scene|background|detail
  mustShow[]                 // ['ripple wall','lid']
  orientation
  negativeSpace              // side + amount (for text)
  productProminence          // hero|soft|absent
  moodRefs / paletteRefs
}

ImageSourceDecision {
  strategy: 'place'|'reference-generate'|'generate'|'composite'
  assetId?                   // placed asset
  referenceAssetIds?         // image-to-image references
  brief?                     // generation brief (vision-grounded if refs present)
}

Deployment {                 // compile an Experience to one format
  experienceId
  format: 'aplus'|'premium-aplus'|'brand-story'|'listing'
  moduleMapping[]            // section/scene → module(s); tall scene → sliced stack
  exportArtifacts            // PNGs per slot + build sheet
  validation                 // per-format rule results
}
```

### Reuse mapping (current → redesign)

| Current                                                         | Becomes                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `strategy` schema (buyer, objections, usableAssets, modulePlan) | **Strategy** + seeds **Narrative**                                              |
| `packageOuter` (creativeDirection, moduleSpecs)                 | `Experience.artDirection` + the **Section** list                                |
| module schemas (company-logo, comparison-table, icon-row…)      | **LayoutIntent** archetypes (decoupled from Amazon names) + A+ Compiler targets |
| `moduleImageSlots` + briefs                                     | `ImageSlot` + `ImageIntent` + `ImageSourceDecision`                             |
| shot bible                                                      | `Experience.artDirection` inherited into every VisualConcept                    |
| Satori `DesignedModule`                                         | A+ Compiler's module renderer                                                   |

Migration = **lift existing concepts up one abstraction level** (away from Amazon
module names → narrative + layout archetypes) + add separate-mobile + asset matcher

- compiler.

### Vocabulary (v1)

**ConversionJob:** `hook` · `problem` · `benefit` · `how-it-works` ·
`differentiation` · `proof` · `comparison` · `use-cases` · `brand` · `cta`.
(each maps to ≥1 of problem/benefit/differentiation/trust/brand/action)

**LayoutIntent archetypes** (decoupled from Amazon module names; `medium` noted):

| Archetype           | Medium   | Native format            | Degrades to                                                  |
| ------------------- | -------- | ------------------------ | ------------------------------------------------------------ |
| full-bleed-hero     | static   | A+                       | —                                                            |
| split-LR            | static   | A+                       | —                                                            |
| lifestyle-immersion | static   | A+                       | —                                                            |
| feature-grid        | static   | A+                       | —                                                            |
| icon-row            | static   | A+                       | —                                                            |
| comparison-table    | static   | A+                       | —                                                            |
| problem-solution    | static   | A+                       | —                                                            |
| dual-use-split      | static   | A+                       | —                                                            |
| stat-band           | static   | A+                       | —                                                            |
| spec-sheet          | static   | A+                       | —                                                            |
| brand-story-band    | static   | A+ / Brand Story         | —                                                            |
| **hotspots**        | hotspots | **Premium A+**           | annotated static image (callouts laid around the base image) |
| **video**           | video    | **Premium A+ / Listing** | poster frame + headline (the required `posterFrame`)         |
| carousel            | static   | Premium A+               | feature-grid / first image                                   |

### Format compatibility & graceful degradation (new architectural principle)

Hotspots and video are **richer media that only some formats support**. So every
archetype/medium declares **which formats host it natively** and **how it degrades**
when compiled to one that doesn't. The Deployment Compiler enforces this:

- **hotspots → Standard A+:** flatten to a static image with the callouts arranged
  around it (no interactivity lost in _meaning_, only in interaction).
- **video → Standard A+ / Brand Story:** drop to the **poster frame + key message**
  (hence `VideoSlot.posterFrame` is required).
- Authoring is always done at the **richest** medium the seller wants; the compiler
  produces the best faithful representation per target format. One Experience →
  many format renderings, each valid.

### Still open

3. **Editing surface** — Section vs Visual vs Deployment granularity; what
   "regenerate section" preserves.
4. **Composition representation** — store resolved compositions, or intents +
   re-resolve? (Lean: store both.)
5. **Video sourcing priority** — UGC ingest (high trust, needs rights capture) vs
   generated B-roll (fast, ambient-only). Recommend UGC-first; generated video for
   ambience only, never product-accurate hero.

---

> **Vocabulary v1 = AGREED.** UGC-first for video (generated = ambience only).

## 5. Engines (first build targets)

### 5a. Narrative Engine — Strategy → ordered Sections

**In:** Strategy (personas, benefit hierarchy, objections, differentiators,
voice) + ProductIntelligence + BrandProfile + goal + format/tier (→ section
budget). **Out:** ordered `Section[]` — a buyer-journey arc, each with a job,
intent, scannable copy, and a `VisualConcept` _stub_ (archetype + image intents,
unresolved).

**Not a template.** The arc is _derived from the strategy_, so two products yield
different narratives:

- **Objection map drives objection-handling sections** — each major objection →
  a `proof` / `comparison` / `how-it-works` section.
- **Benefit hierarchy drives desire sections** — top benefits → `benefit` /
  `use-cases` sections, weighted by rank.
- **Skeleton (soft, not fixed):** `hook` → (problem) → benefits → differentiation
  → proof → use-cases → brand → cta. The engine _selects, orders, and weights_
  beats per product (a commodity leans differentiation+comparison; a premium brand
  leans brand+proof; a technical product leans how-it-works+spec).
- **Budget:** tier → target section count; prioritize highest-leverage jobs (top
  benefits + biggest objections) when trimming.
- **Layout assignment:** job + content shape → LayoutIntent (numbers→`stat-band`,
  vs-alternatives→`comparison-table`, many benefits→`feature-grid`/`icon-row`),
  with a no-repeat-back-to-back diversity constraint.
- **Conversion discipline baked into copy:** one idea per section, hard word caps,
  benefit-forward headlines. (Reuse current copy guardrails.)

**Mechanism (reframes current pipeline):** (1) a planning call → beats + jobs +
archetypes + order (structured output); (2) a writing call → per-section copy +
ImageIntents. This is today's `packageOuter` + module-copy steps, replanned
against **jobs/archetypes** instead of `amazonModuleType`.

### 5b. Asset Matcher — ImageIntent → place / reference-generate / generate

**In:** an `ImageIntent` + the pool of `AssetProfile`s + brand/shot-bible.
**Out:** an `ImageSourceDecision`.

1. **Filter** candidates: subject compatibility (product/background), media type.
2. **Score** (weighted): affordance match (high) · subject+prominence fit ·
   composition fit (orientation + **negative-space side** for text) · quality gate
   (resolution; `hasBakedText` disqualifies _placement_) · brand/color fit ·
   `mustShow` coverage.
3. **Decide:**
   - clears place-threshold + directly usable → **place** (use the asset as-is).
   - good product-iso but scene needs richer environment → **reference-generate**
     (image-to-image; asset = product reference; brief from intent + shot bible).
   - background-only, product needed on top → **composite**.
   - nothing clears threshold → **generate** (text-to-image).
4. **Always prefer real-product fidelity:** even on `generate`, if _any_
   product-iso asset exists, attach it as a reference so the generated product
   matches the real one. (This is the seller's "use my photos as inspiration.")
5. **Override:** the decision is a default — seller can pin/force per slot.

**Reuse:** vision-describe → `AssetProfile`; `moduleImageSlots` + image-generate →
the execution layer. The matcher is the new glue between them.

### Recommended first slice

Build **5b (matcher) + reference-generate** first: smallest surface, biggest
visible win (uploaded + catalog photos finally drive the imagery), and it proves
the asset thesis without the full narrative rebuild. **5a** is the larger
structural change; stage it behind 5b.

## 6–9. Roadmap / migration (folded later)

Strangler-fig migration · mobile (separate compositions) · cross-content reuse ·
quick wins (matcher+reference-gen, separate-mobile, whole-narrative, catalog
image import).
