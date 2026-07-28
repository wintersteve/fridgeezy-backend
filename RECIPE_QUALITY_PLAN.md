# Recipe Quality Plan — Authenticity, Dedup, Canonical Naming

Created 2026-07-28.

Scope: fix suggestion + ingredient generation so that (1) only **authentic**
dishes enter discovery (no hallucinations, no invented mashups), (2) the same
dish under different names is a **single** canonical entry (Papaya Salad ≡ Som
Tam), (3) genuine attested variations stay **distinct** (Som Tam Thai ≠ Som Tam
Lao), while inventions (Carbonara with Asparagus) are allowed only as on-demand
user recipes, and (4) identity keys off the **canonical English name**, not the
native string.

This is separate from `TODOS.md` (the Lambda + Bedrock migration). Where the two
overlap (embeddings, in-DB OpenAI calls), it's called out.

---

## Settled decisions (from design review)

- **Identity = canonical English name + enriched signature**, not the native
  name string.
- **Generation emits the canonical English name directly**; a resolver validates
  it. Prefer **grounding** generators with retrieved catalog candidates over
  free-texting + reconciling.
- **Authenticity is a distinct verification pass**, not just prompt text — it
  survives a model swap and separates concerns.
- **Ingredients are a prerequisite for dish dedup** — a dish signature is only
  stable if its ingredients are canonical. Sequence ingredients first.
- **One embedding model** everywhere. Default: standardize on
  `text-embedding-3-large` (3072d) — it's the dedup-critical quality path and the
  corpus is small enough that re-embedding is cheap. (Only open decision — see
  Phase 1.)

---

## Current-state summary (what's broken, grounded in code)

Dish dedup (`persist-or-reuse-suggestion.ts`):
- Layer 1 exact match keys on `canonical_id = slug(native name)`.
- Layer 2 vector cosine **≥ 0.95** on an embedding of the **name only**
  (`set_recipe_suggestion_embedding` trigger embeds `TRIM(LOWER(name))`, not
  "name + description" as its comment claims).
- ⇒ Papaya Salad vs Som Tam: different slug, name-cosine ~0.3–0.5 → **both
  created**. The 0.95 threshold is a spelling-variant catcher, not semantic dedup.

Authenticity: enforced **only by the prompt** in
`generate-suggestions-stream.ts`. No verification pass. No distinction between a
hallucinated dish, an attested regional variant, and an invented mashup.

Ingredient matching (`match-ingredients.ts`): canonical_id → alias → vector(0.85)
→ **auto-create**, with:
- vector matches that don't **learn** (no alias written back),
- **unbounded auto-create** with no "is this real?" gate and nearest-centroid
  category assignment that "always returns a match,"
- the generator's `category`/`parent` **discarded** (suggestion path) while
  `persist_recipe` uses them → two divergent category pipelines,
- a **double-embed bug** (Step 4 recomputes the Step 3 embedding) and fully
  **sequential** per-item embedding + DB round-trips.

Embeddings: **two models** — recipes/suggestions `text-embedding-3-large` (3072,
in-DB via the `http` extension = blocking OpenAI call inside Postgres);
ingredients/tags/categories/units `text-embedding-3-small` (1536, app-side). Not a
live mismatch (separate columns), but 2× surface + a blocking DB→OpenAI call.

---

## Phase 0 — Quick robustness fixes (independent, ship now)

Low-risk, no design dependency.

- [ ] Remove debug logging in `find-suggestion-by-name.ts`
      (`console.log(name)`, `console.log("result", result)`).
- [ ] Fix the **double-embed** in `match-ingredients.ts` Step 4 — reuse the
      embedding computed in Step 3 instead of regenerating it for the same name.
- [ ] `extract-ingredients.ts`: guard `JSON.parse(content)` and the Zod
      `.parse` (return a typed error, not an uncaught 500), and raise
      `max_completion_tokens` (or stream) so busy images don't truncate the JSON.
- [ ] Align the `set_recipe_suggestion_embedding` trigger comment with reality
      (it embeds name only) — or decide to actually include description (Phase 3
      supersedes this with the signature).

**Acceptance:** no debug noise in prod logs; new-ingredient creation makes one
embedding call, not two; a token-overflowing camera image returns a handled
error.

---

## Phase 1 — Embedding consolidation (foundational)

- [ ] **Decide the single model** (default: `text-embedding-3-large` / 3072).
      This is the one open decision — confirm before the re-embed.
- [ ] Move the **in-DB `generate_embedding`** (the `http`-extension OpenAI call
      inside Postgres) into the app layer / a dedicated embedding service. DB
      functions receive a precomputed vector instead of calling out. Removes the
      DB→OpenAI coupling and unblocks the Bedrock migration (model no longer
      hardcoded in SQL).
- [ ] Migrate any column not on the chosen model (dimension change) and
      **re-embed** the affected corpus (ingredients/tags/categories/units if
      moving to 3072, or recipes/suggestions if moving to 1536).
- [ ] Collapse `generate_embedding` / `generate_embedding_small` to one.

**Acceptance:** one embedding model across all tables; no outbound HTTP from
Postgres; all `search_*` functions take a precomputed vector.

---

## Phase 2 — Ingredient canonicalization (prerequisite for dish dedup)

Goal: a canonical ingredient catalog that stays clean and gets smarter, so dish
signatures are stable.

- [ ] **Canonical English ingredient name as identity** (not raw slug). Ground
      the generators: pass retrieved candidate catalog ingredients into the
      suggestion/recipe prompts so the model reuses canonical names rather than
      free-texting. (Fallback: a post-hoc resolver step.)
- [ ] **Alias-learning loop**: when the vector step matches a surface name to an
      existing ingredient (e.g. "spring onion" → "scallion"), **write the alias**
      so the next hit is an O(1) exact match and the synonym graph becomes real.
- [ ] **Creation gate** (ingredient-level authenticity): no auto-create on a bare
      miss. Near-miss band → LLM adjudication ("is X the same as candidate Y?").
      Genuine new → an "is this a real culinary ingredient?" check + a confidence
      floor before minting a row.
- [ ] **Use the generator's `category`/`parent`** (validated against the
      controlled category set) instead of nearest-centroid auto-assignment; keep
      centroid only as a last-resort fallback. **Unify** the two category
      pipelines (`persist_recipe` get-or-create vs `matchIngredients` centroid)
      into one.
- [ ] **Leverage `parent`** hierarchy for rollup/dedup (leg_of_lamb ⊂ lamb) —
      pass category/parent through the suggestion matcher (currently `string[]`).
- [ ] **Performance:** batch embeddings (OpenAI array input), parallelize
      per-item vector searches.
- [ ] **Backfill**: one-time pass to dedupe + re-canonicalize existing
      ingredients and seed aliases from current near-duplicates.

**Acceptance:** "scallion"/"spring onion"/"green onion" resolve to one row;
alias table grows automatically on fuzzy matches; a hallucinated ingredient is
rejected, not persisted; one category pipeline; new-ingredient batch is
parallel, not serial.

---

## Phase 3 — Dish identity + semantic dedup

Built on canonical ingredients from Phase 2.

- [ ] **Canonical English name** as the dish identity key; native name (`Som
      Tam`) becomes a display alias. Generation emits it; resolver validates.
- [ ] **Signature embedding**: embed a canonical signature, not the bare name —
      `canonical_english_name | cuisine | sorted(core ingredient canonical
      names)`. Replaces the name-only embedding in
      `set_recipe_suggestion_embedding`.
- [ ] **Two-stage dedup** in `persist-or-reuse-suggestion.ts`:
  - Layer 1 — exact canonical_id on the **English** name.
  - Layer 2 — vector recall top-K on signature embeddings → bands:
    `≥ HIGH` auto-merge · `≤ LOW` auto-distinct · **middle → LLM adjudicator**
    ("same dish?") fed both signatures. Cache adjudication outcomes to avoid
    re-asking.
  - Merge = reuse the existing dish and record the alternate name(s) as aliases.
- [ ] Retire the single magic `0.95` name threshold.
- [ ] **Backfill**: re-signature + dedupe existing `recipe_suggestions` (the
      `20260727000011` migration already showed 15 suggestion/recipe name
      collisions — expect cross-name dish duplicates too).

**Acceptance (regression fixtures):** Papaya Salad ≡ Som Tam (merge); Som Tam ≡
Som Tam Thai (merge or adjudicated same); Som Tam Thai ≠ Som Tam Lao (distinct);
all keyed on the English name.

---

## Phase 4 — Authenticity gate + variation model

- [ ] **Verification pass** (distinct from generation), batched over the 4
      suggestions. Input: English name, cuisine, core ingredients. Output:
      `{ exists, attested_status, confidence, canonical_english_name,
      parent_dish? }` where `attested_status ∈ {canonical, regional_variant,
      modern_fusion, invention, unknown}`.
- [ ] **Gate**: only `canonical` + `regional_variant` above a confidence floor
      enter the discovery/suggestion pool. `modern_fusion` / `invention` are
      allowed **only** as on-demand user generations and excluded from discovery
      (the dish-level analog of `recipes.base_recipe_id` hiding).
- [ ] **Dish-family variation model**: a canonical-dish family (parent) ↔ variant
      link, distinct from `recipes.base_recipe_id` (which is AI *recipe* variants).
      Attested regional variants each keep their own canonical identity but link
      to a family (e.g. `parent_dish_id` on the suggestion/dish, or a
      `canonical_dishes` table). Ingredients + cuisine differences drive whether a
      variant is distinct.

**Acceptance:** a hallucinated dish never persists as a suggestion; Carbonara
with Asparagus is generatable on demand but never appears in discovery; Som Tam
Thai and Som Tam Lao both persist and link to the "Green Papaya Salad" family.

---

## Phase 5 — Eval harness, observability, rollout

- [ ] **Eval harness** (build early, use throughout): fixed input set scored on
      authenticity (real dish?), dedup (merge/distinct correctness on the Phase 3
      fixtures), naming (English canonical?), and structure (valid JSONL, exactly
      1 component/cuisine/course tag, non-zero nutrition). This is the gate for
      every phase.
- [ ] **Observability**: log dedup decisions (merged / distinct / adjudicated +
      scores), authenticity verdicts, alias-learning events, and match-type
      stats (extend the existing `[Suggestions]`/`[Ingredients]` logs).
- [ ] **Rollout**: feature-flag the new dedup + authenticity paths; shadow-run
      against the eval harness; compare to the current behavior before cutover.

**Acceptance:** eval scores meet or beat the current baseline on every axis;
decisions are traceable in logs; new behavior ships behind a flag with rollback.

---

## Dependency ordering (do not reorder)

```
Phase 0  (quick fixes)         ── independent, anytime
Phase 1  (one embedding model) ── foundational, before Phase 3
Phase 2  (canonical ingredients) ── PREREQUISITE for Phase 3
Phase 3  (dish signature dedup)  ── needs Phase 1 + Phase 2
Phase 4  (authenticity + variations) ── needs Phase 3 identity
Phase 5  (eval + rollout)        ── harness built early, gates all phases
```

## Cross-cutting notes

- **Performance spine** (applies to Phases 2–4): batch embeddings, parallelize
  vector searches, reuse computed embeddings, and keep the per-suggestion
  pipeline from running N sequential round-trips inside the stream.
- **Bedrock migration overlap** (`TODOS.md`): Phase 1 (embedding out of Postgres,
  one model) directly de-risks the inference migration. The authenticity
  verification pass (Phase 4) is a natural place to A/B Bedrock models later.
