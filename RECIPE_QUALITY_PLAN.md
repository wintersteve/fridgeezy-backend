# Recipe Quality Plan — Authenticity, Dedup, Canonical Naming

Created 2026-07-28.

## Status (2026-07-28)

All phases implemented and merged:
- **Phase 0** — quick fixes (#1). **Phase 1** — embedding consolidation to
  text-embedding-3-small, no PG-side OpenAI, HNSW indexes (#5/#6/#7/#8, migrations
  applied + backfilled).
- **Phase 2** — ingredient canonicalization: alias-learning (#9), creation gate
  (#10), LLM category (#11), dedup backfill + merge_ingredient (#12).
- **Phase 3** — dish-signature dedup (#13). **Phase 4** — authenticity gate (#14).
- **Phase 5** — eval harness (`nx run @fridgeezy/api:eval`): **8/8** on the
  acceptance fixtures (Som Tam ≡ Green Papaya Salad, Murgh Makhani ≡ Butter
  Chicken merge; Som Tam Thai ≠ Lao, Roux ≠ Béchamel distinct; Carbonara-with-
  Asparagus + gibberish dropped). Observability = the `[Suggestions]`/
  `[Ingredients]` decision logs added throughout.

Deferred follow-ups (non-blocking): English-name `canonical_id` identity + a
suggestion alias table; the dish-family (`parent_dish`) variation model; full
SQL/TS ingredient-pipeline unification + `parent`-hierarchy rollup; grounding
generation by retrieval; feature-flagged shadow rollout.

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
- **One embedding model** everywhere — **CONFIRMED: `text-embedding-3-small`
  (1536d)** (2026-07-28). pgvector can't build an HNSW/IVFFlat index above 2000
  dims, so the 3072/large columns are un-indexable (the recipe index is literally
  commented out for this reason). 1536/small is indexable everywhere and lets us
  finally index the recipe/suggestion vectors that are currently seq-scanned;
  quality delta on short text (names, signatures) is modest and Phase 3's dedup
  adds LLM adjudication anyway. This reverses the plan's original 3-large default.
  ⇒ re-embed `recipes` + `recipe_suggestions` (large→small); ingredients / tags /
  categories / units already match.

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

- [x] **Decide the single model** — CONFIRMED `text-embedding-3-small` (1536),
      for the pgvector index-cap reason above.
- Progress: tags (#5), recipe_suggestions (#6 / slice 2a), recipes (slice 2b),
  cleanup + indexes (slice 3). Phase 1 code complete — apply the migrations + run
  the `embed-suggestions` / `embed-recipes` backfills to finish it on the DB.
- [x] Move the **in-DB `generate_embedding`** into the app layer — search/store
      functions now take a precomputed vector; done across slices 1/2a/2b.
- [x] Migrate the off-model columns (`recipes.fts`, `recipe_suggestions.embedding`)
      3072→1536 and re-embed via the backfill scripts.
- [x] Collapse `generate_embedding` / `generate_embedding_small` — both **dropped**
      in slice 3 (nothing calls them in-DB anymore).

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
- [x] **Alias-learning loop** (#9): the vector step writes the surface name as an
      alias so the next hit is an O(1) exact match.
- [x] **Creation gate** (#10): gray-band [0.70, 0.85) + LLM adjudication —
      same → reuse candidate; invalid → drop (no catalog pollution); new → create.
- [x] **LLM-chosen category** (#11): the adjudication picks a controlled-vocabulary
      category, centroid only as fallback (the suggestion path's analog of "use the
      generator's category"). Full SQL/TS pipeline unification remains a larger
      follow-up (noted below).
- [x] **Backfill** (#12): `dedupe-ingredients` script + `merge_ingredient` RPC —
      finds near-duplicate rows (vector + LLM confirm), clusters them, folds each
      into its oldest member (atomic reference repoint), seeding aliases. Dry-run
      by default (`DEDUP_APPLY=true` to execute).

Deferred to a later pass (not blockers for Phase 3): grounding *generation* by
retrieval (doesn't fit the suggestion flow — the resolver above is the grounding);
full `persist_recipe`(SQL) vs `matchIngredients`(TS) unification; `parent`-hierarchy
rollup; batch/parallel embedding in the matcher.

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
      dedupe-suggestions-against-recipes migration already showed 15
      suggestion/recipe name
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
