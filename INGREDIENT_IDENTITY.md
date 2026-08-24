# Preventing duplicate ingredients

**Status:** steps 1 and 2 IMPLEMENTED (2026-08-23). Step 3 deferred. No cleanup run.
**Date:** 2026-08-23.
**Measured against:** the live dev project `qkxznjwlybjqpcauaisz`, read-only.

> **What shipped**
>
> | | |
> | --- | --- |
> | `20260823000003_ingredient_alias_identity.sql` | canonical alias key + `ingredient_alias_collisions` view |
> | `libs/toolkit/.../ingredient-identity.ts` | the structural interlock, shared by write path and audit |
> | `IngredientsRepository` | `findByAliasCanonicalIds`, `vectorSearchMany` |
> | `adjudicate-ingredient.ts` | shortlist form, `matchIndex` verdict |
> | `match-ingredients.ts` | canonical alias lookup, top-10 retrieval, interlock |
> | `check-ingredient-identity` | the regression sweep below |
>
> **Headline result, measured over all 1067 ingredients:**
> names offered a candidate that must never merge — **327 before, 0 after**.
> Unexpected merges in the deterministic layers: **0**.
> `Green Onion` and `Spring Onion` both now reach `Scallion`.
>
> See §8 for what the sweep found, including two things it got wrong first.

---

## Summary

The resolve-or-create step you described **already exists** — `matchIngredients`
is four layers deep and its header comment names the scallion↔green-onion problem
by hand. It isn't a missing design. It's a working design with **three concrete
defects**, and duplicates come through all three:

| # | Defect | Evidence |
| --- | --- | --- |
| 1 | **The alias lookup is case-sensitive and never matches.** `findByAliases` does `.in("alias", names)` with Title-Case model output against 236 lowercase-stored aliases. | `ingredient_aliases` already maps `green onion → Scallion` **and** a separate `Green Onion` ingredient row exists |
| 2 | **Vector retrieval returns exactly one candidate** (`match_count: 1`), and the nearest neighbour is systematically a *sibling*, not the synonym. | For `Green Onion`, rank 1 is **White Onion** (0.802); Scallion isn't in the top 3 |
| 3 | **The SQL pipeline has no resolve step at all.** `persist_recipe` does `ON CONFLICT (canonical_id)` and never consults aliases, embeddings or an LLM. | All 20 embedding-less ingredients have **zero suggestion uses** — they can only have come from this path |

**50 ingredient rows currently collide with an existing alias.** Fixing defect 1
alone catches Scallion/Green Onion/Spring Onion, All Purpose Flour (27 uses),
Pepper (25 uses), Beetroot, Active Dry Yeast and Parmesan Cheese — with no
embeddings and no LLM calls.

And the central design finding, in one line:

> **No cosine threshold can separate a duplicate from a sibling.** In this
> catalogue `Flour ↔ Rice Flour` (must stay apart, 0.625) scores **higher** than
> `Flour ↔ All Purpose Flour` (must merge, 0.619). The separating signal is
> structural, not metric.

---

## 1. Every write path that can create an ingredient

| # | Entry point | Creates via | Gated? |
| --- | --- | --- | --- |
| A | `POST /suggestions/generate` → `persist-suggestion.ts` | `matchIngredients` | **Yes** — canonical → alias → vector → LLM |
| B | `POST /ingredients/extract` (fridge photo) → `extract-ingredients.ts` | `matchIngredients` | **Yes** — same path |
| C | `POST /recipes/import` → `import-recipe.ts` | `matchIngredients`, then `persist_recipe_with_ingredient_ids` | **Yes** |
| D | `POST /recipes/generate`, `/modify`, `/difficulty/escalate` → `persistRecipe()` | **`persist_recipe` SQL** | **No** — `ON CONFLICT (canonical_id)` only |
| E | `seed-ingredients` operation | direct insert | n/a — curated |
| F | `POST /suggestions/:id/promote` | `persist_recipe_with_ingredient_ids` | n/a — takes resolved ids |

**D is the unguarded one**, and CLAUDE.md already flags it as the "Two ingredient
pipelines" deliberate gap. Its cost is now measurable.

### What path D produces

`persist_recipe` inserts `(canonical_id, name, category_id)` and nothing else —
**no embedding, no alias, no adjudication.** So its rows are not merely
duplicates, they are *invisible to every future match attempt*: a row with a NULL
embedding can never be returned by `vectorSearch`. Path D is a
self-perpetuating fragmentation sink.

All 20 NULL-embedding rows, and note what they are:

```
Freshly Ground Black Pepper   ← vs Black Pepper, vs Pepper
Kosher Salt (2 uses)          ← vs Salt
Dried Shiitake Mushrooms      ← vs Shiitake Mushrooms
Toasted Sesame Seeds          ← vs Sesame Seeds
Unsalted European Butter      ← vs Butter, Unsalted Butter
Wagyu Ground Beef             ← vs Ground Beef
Heirloom Tomato               ← vs Tomato
Cave-Aged Gruyère Cheese      Baby Arugula      Truffle Aioli
```

That reads like the output of `escalate-difficulty` — the model reaches for a
fancier register, and every embellished name becomes a permanent new entity.
18 of the 20 also have no category.

---

## 2. Why the existing controls don't hold

### The constraints

```sql
ingredients.canonical_id  text not null unique
ingredients.name          text not null unique
ingredient_aliases.alias  text not null unique
```

`ingredient_canonical_id()` lowercases, collapses non-alphanumerics to `_`, and
singularises the **last token only**. So:

```
"Spring Onion" → spring_onion      "Green Onion" → green_onion      "Scallion" → scallion
```

Three distinct canonical ids. The unique constraint is doing its job perfectly —
it enforces **string identity**, and these are three different strings. It was
never a semantic control and cannot become one.

**And nothing constrains an ingredient name against the alias table**, which is
where the real contradiction lives.

### The exact causal chain for "Green Onion"

1. Model emits `"Green Onion"`.
2. **Step 1** — canonical `green_onion`, no ingredient row. Miss.
3. **Step 2** — alias lookup `.in("alias", ["Green Onion"])`. The stored alias is
   `"green onion"`, lowercase. PostgREST `.in()` is case-sensitive. **Miss** —
   even though the table holds the correct answer.
4. **Step 3** — `vectorSearch(embedding, 0.6)` with `match_count: 1` returns
   **White Onion** (0.802). Scallion is at 0.681, far down the list.
5. `sameTokenSet("Green Onion", "White Onion")` → false, so no auto-accept.
6. **LLM adjudicates**: *"Is Green Onion the same as White Onion?"* → correctly
   **no**.
7. **Creates `Green Onion`.**

Every layer behaved exactly as written. The synonym was never a candidate.

### The retrieval is biased toward the wrong answer

This is the part worth dwelling on. Embedding similarity is lexical, so a
**shared head noun dominates**. "White Onion" and "Green Onion" share the token
*Onion*; "Scallion" shares nothing. Therefore:

> Rank-1 retrieval systematically surfaces **siblings** — the candidates that
> must *not* merge — and hides **synonyms**, the ones that must.

Confirmed on every fragmented pair in the catalogue:

| New name | Rank 1 (what the LLM saw) | Rank 2 | Rank 3 |
| --- | --- | --- | --- |
| Green Onion | **White Onion** 0.802 | Spring Onion 0.792 | Fried Onions 0.694 |
| Soya Sauce | **Sweet Soy Sauce** 0.871 | Light Soy Sauce 0.820 | **Soy Sauce 0.819** |
| Red Beets | **Boiled Beets** 0.754 | Beetroot 0.752 | Beets 0.750 |
| Active Dry Yeast | **Instant Yeast** 0.665 | Yeast 0.603 | Nutritional Yeast 0.526 |
| All Purpose Flour | **Bread Flour** 0.682 | Self-Rising Flour 0.662 | Whole Wheat 0.623 |
| Cilantro | **Fresh Cilantro** 0.799 | Coriander 0.682 | Fresh Coriander 0.633 |

`Soya Sauce` is the sharpest: rank 1 scored **0.871, above the 0.85 accept
threshold**. It was saved from auto-merging into *Sweet Soy Sauce* only by the
`sameTokenSet` guard — which is doing real work — and then the LLM was asked
about the wrong pair while plain `Soy Sauce` sat at rank 3.

### Why no threshold can fix this

Sorting the pairs I can adjudicate by hand, by cosine:

| cos | pair | correct action |
| --- | --- | --- |
| 0.600 | Egg ↔ Chicken Egg | **MERGE** |
| 0.603 | Active Dry Yeast ↔ Yeast | **MERGE** |
| 0.605 | Brown Sugar ↔ Sugar | keep distinct |
| 0.619 | All Purpose Flour ↔ Flour | **MERGE** |
| 0.625 | Flour ↔ Rice Flour | keep distinct |
| 0.681 | Scallion ↔ Green Onion | **MERGE** |
| 0.682 | Coriander ↔ Cilantro | **MERGE** |
| 0.766 | Chicken Egg ↔ Duck Egg | keep distinct |
| 0.813 | White Pepper ↔ Black Pepper | keep distinct |
| 0.885 | Green Bell Pepper ↔ Red Bell Pepper | keep distinct |

Completely interleaved. **Any threshold that merges `All Purpose Flour → Flour`
also merges `Rice Flour → Flour`**, which is exactly the silent corruption you
warned about. Tuning this number is not an option that exists; it is the wrong
kind of quantity.

---

## 3. What actually separates a duplicate from a sibling

Not magnitude — **structure**. Decompose the canonical id into a **head noun**
(last token, already singularised) and a **modifier set** (the rest):

| name | head | modifiers |
| --- | --- | --- |
| `green_onion` | onion | {green} |
| `white_onion` | onion | {white} |
| `scallion` | scallion | {} |
| `chicken_egg` | egg | {chicken} |
| `rice_flour` | flour | {rice} |
| `all_purpose_flour` | flour | {all, purpose} |

Three classes, with different burdens of proof:

| Class | Shape | Meaning | Default |
| --- | --- | --- | --- |
| **SIBLING** | same head, **both** modified | a contrast *within* a kind — variety, colour, animal, grain | **presume DISTINCT** |
| **BARE_VS_MOD** | same head, one bare | either "the default kind" or "a specific kind" | ask |
| **DIFF_HEAD** | different heads | different words entirely — the synonym shape | ask |

Run over every embedding-near pair (cos > 0.60) in the live catalogue:

```
DIFFERENT HEAD                       1102
SIBLING (same head, both modified)    661
BARE vs MODIFIED (same head)          206
```

And on the pairs that matter:

```
SIBLING      Chicken Egg | Duck Egg          0.766   ← protected structurally
SIBLING      White Pepper | Black Pepper     0.813   ← protected structurally
SIBLING      Green Bell | Red Bell Pepper    0.885   ← protected structurally
BARE_VS_MOD  Flour | Rice Flour              0.625   ← must be asked, carefully
BARE_VS_MOD  Flour | All Purpose Flour       0.619   ← alias already answers
DIFF_HEAD    Scallion | Green Onion          0.681   ← alias already answers
DIFF_HEAD    Scallion | Spring Onion         0.680   ← alias already answers
DIFF_HEAD    Coriander | Cilantro            0.682   ← ask
```

**The structural rule protects all three of your named danger cases** — Chicken
Egg/Duck Egg, Flour/Rice Flour, and the bell peppers — without any threshold.

### Where structure runs out, and why that needs a human

Be honest about the limit:

```
SIBLING   Green Onion | Spring Onion   same head {green} vs {spring}   → SAME THING
SIBLING   Chicken Egg | Duck Egg       same head {chicken} vs {duck}   → DIFFERENT THINGS
```

**Structurally identical, semantically opposite.** No rule over the strings can
separate them; it takes world knowledge. So structure cannot be a *decision* — it
sets the default and the burden of proof, and something else adjudicates.

That is the ambiguous middle, and per your instruction it gets a human rather
than a tuned threshold. Sized in §6: **9 pairs.**

---

## 4. The design

Four layers, in cost order. Layers 1–2 are exact and free; 3 costs an LLM call;
4 costs human attention and is rare.

```
resolve_ingredient(name)
  │
  ├─ 1. canonical_id exact ─────────────► resolve        (free, exact)
  ├─ 2. alias canonical exact ──────────► resolve        (free, exact)   ← currently broken
  │
  ├─ 3. retrieve top-10 by embedding, ≥0.55
  │     classify each candidate structurally
  │     ├─ SIBLING      → drop from shortlist (presumed distinct)
  │     └─ others       → ONE LLM call over the WHOLE shortlist
  │           ├─ "same as <X>"  → resolve to X, learn alias
  │           └─ "new"          → create
  │
  └─ 4. conflicts (alias says same, structure says sibling)
        → create the row, queue the pair for human review
```

Two properties carried over from the existing code, deliberately:

- **Never block a request.** CLAUDE.md: *"a junk row is the cheap error and a
  lost ingredient is not."* Layer 4 creates the row and flags it; it never
  refuses.
- **Learn the alias on every accept**, so the next occurrence resolves at layer 2
  for free. This is what makes the system converge rather than pay an LLM
  forever.

### 4.1 The migration

**(a) Give aliases the same canonical identity ingredients have.** This mirrors
`set_ingredient_canonical_id_trigger` exactly, so the rule lives in one place.

```sql
alter table ingredient_aliases add column alias_canonical_id text;

create or replace function public.set_alias_canonical_id()
    returns trigger language plpgsql as $$
begin
    new.alias_canonical_id := ingredient_canonical_id(new.alias);
    return new;
end $$;

create trigger set_alias_canonical_id_trigger
    before insert or update on ingredient_aliases
    for each row execute function set_alias_canonical_id();

update ingredient_aliases set alias = alias;   -- fire the trigger to backfill

-- collapse "Green Onion" / "green onion" duplicates BEFORE this index
alter table ingredient_aliases alter column alias_canonical_id set not null;
create unique index ingredient_aliases_canonical_key
    on ingredient_aliases (alias_canonical_id);
```

The existing `alias unique` constraint permitted `"Green Onion"` and
`"green onion"` as two rows — that is defect 1 embedded in the schema, and this
index is what closes it.

**(b) One resolve step, shared by both pipelines.**

```sql
create or replace function public.resolve_ingredient(
    p_name text,
    p_category_id uuid default null
) returns uuid language plpgsql as $$
declare
    v_cid text;
    v_id  uuid;
begin
    v_cid := ingredient_canonical_id(p_name);
    if v_cid = '' then
        raise exception 'resolve_ingredient: empty name %', p_name;
    end if;

    -- 1. canonical identity
    select id into v_id from ingredients where canonical_id = v_cid;
    if found then return v_id; end if;

    -- 2. alias identity (case-insensitive by construction)
    select ingredient_id into v_id
    from ingredient_aliases where alias_canonical_id = v_cid;
    if found then return v_id; end if;

    -- 3. genuinely new
    insert into ingredients (canonical_id, name, category_id)
    values (v_cid, p_name, p_category_id)
    on conflict (canonical_id) do update set canonical_id = excluded.canonical_id
    returning id into v_id;
    return v_id;
end $$;
```

`persist_recipe`'s ingredient block then becomes one line, replacing the raw
`INSERT … ON CONFLICT`:

```sql
v_ingredient_id := resolve_ingredient(v_ingredient->>'name', v_category_id);
```

Note what this does *not* do: it adds no embedding and no LLM to path D. That is
deliberate — SQL cannot call out — and it is why path D still wants layer 3. The
cheapest correct fix for that is to **route `persistRecipe` through
`matchIngredients` first** and switch it to `persist_recipe_with_ingredient_ids`,
which is what `promote` and `import` already do. `resolve_ingredient` is then the
backstop for anything that still reaches the SQL path, not the whole answer.

**(c) The review queue, which is also the drift detector.**

```sql
create table ingredient_merge_reviews (
    id           uuid primary key default gen_random_uuid(),
    ingredient_a uuid not null references ingredients(id) on delete cascade,
    ingredient_b uuid not null references ingredients(id) on delete cascade,
    evidence     jsonb not null,      -- {source, cosine, head, mods_a, mods_b}
    status       text not null default 'pending'
                 check (status in ('pending','merged','distinct')),
    decided_at   timestamptz,
    created_at   timestamptz not null default now(),
    constraint ingredient_merge_reviews_ordered check (ingredient_a < ingredient_b),
    constraint ingredient_merge_reviews_pair_key unique (ingredient_a, ingredient_b)
);
```

The `ingredient_a < ingredient_b` check is what stops the same pair being queued
twice in opposite orders. A `distinct` verdict is **sticky** — it must suppress
the pair permanently, or the drift check re-raises it every night forever.

### 4.2 The rule the LLM is held to

Written once, in the repo's existing style (`DISH_NAME_RULE`,
`BLACKLIST_RULE`), and shared by `adjudicate-ingredient.ts` and
`dedupe-ingredients.ts` so the write path and the audit cannot disagree.

> **INGREDIENT_IDENTITY_RULE.** Two names are the same ingredient only if a cook
> could swap one for the other and notice nothing. **Name the difference first.**
> If you cannot name a difference a cook would taste, see, or shop for
> differently, they are the same.

| Stays distinct | Because |
| --- | --- |
| Chicken Egg / Duck Egg | different bird — size, richness, ratio |
| Flour / Rice Flour | different grain; no gluten, not interchangeable |
| Black Pepper / White Pepper | different processing, different flavour |
| Green / Red Bell Pepper | ripeness changes sweetness |
| Sugar / Brown Sugar | molasses |

| Merges | Because |
| --- | --- |
| Scallion / Green Onion / Spring Onion | regional names for one plant |
| Cilantro / Coriander *(leaf)* | US / UK names |
| Parmesan / Parmesan Cheese | "cheese" adds nothing |
| Ground Pork / Minced Pork | US / UK |
| Turmeric / Turmeric Powder | form of the same spice, as sold |

The presentation change matters as much as the wording: the LLM is shown **the
whole shortlist at once** and asked *which, if any*. Today it is shown one
candidate and asked yes/no, which is why it kept correctly answering "no" to a
question about the wrong ingredient.

---

## 5. Catching drift after the fact

Prevention is not enough, for a reason specific to this schema: **an alias can be
wrong.** The catalogue contains `red bell pepper → Green Bell Pepper`, which is
simply a mistake, and layer 2 would act on it with full confidence.

Two checks, both cheap:

**(a) The exact one — no embeddings, no LLM.** Any ingredient row whose canonical
id is claimed by an alias pointing elsewhere is, by construction, a duplicate:

```sql
create or replace view ingredient_alias_collisions as
select i.id dup_id, i.name dup_name, t.id keep_id, t.name keep_name, a.alias
from ingredients i
join ingredient_aliases a on a.alias_canonical_id = i.canonical_id
join ingredients t on t.id = a.ingredient_id and t.id <> i.id;
```

**This returns 50 rows today.** After the fix it should return zero, which makes
it an assertion, not a report. Wire it into a
`check-ingredient-identity` target next to `check-recipe-visibility` and
`check-menu-visibility`.

**(b) The fuzzy one — nightly, structural, no LLM.** Every non-SIBLING pair above
0.60 with no alias linking them is a candidate; anything not already decided goes
into `ingredient_merge_reviews`. That is the periodic surface you asked for, and
it converges: each resolved pair either becomes an alias (silencing it) or a
sticky `distinct` verdict.

---

## 6. What this would have done to the fragmentation already found

Run against the real catalogue, read-only.

### Would it catch Scallion / Green Onion / Spring Onion?

**Yes — at layer 2, free, no LLM, no embeddings.** Both aliases already exist:

```
green onion  → Scallion        (ingredient row "Green Onion",  4 uses)
spring onion → Scallion        (ingredient row "Spring Onion", 3 uses)
```

Both are `DIFF_HEAD`, so no structural conflict blocks them. And note the
transitive case dissolves: since *Green Onion* and *Spring Onion* each resolve to
**Scallion**, the awkward `Green Onion ↔ Spring Onion` sibling pair never has to
be adjudicated at all.

### Would it wrongly merge anything currently distinct?

**No.** Of the 50 alias-collision pairs:

| Disposition | Pairs | Edges repointed |
| --- | --- | --- |
| `DIFF_HEAD` → auto-merge (alias authoritative) | 26 | 59 |
| `BARE_VS_MOD` → auto-merge (alias authoritative) | 14 | 68 |
| **`SIBLING` → human review** | **10** | **3** |

**40 automatic merges moving 127 edges; 10 pairs to a human, holding 3 edges
between them.** The stakes on the ambiguous set are almost nil, which is exactly
the shape you want — the uncertainty is concentrated where the data is thin.

The 9 embedding-near conflicts in full — this is the entire human workload:

| pair | cos | my read |
| --- | --- | --- |
| **Green Bell Pepper vs Red Bell Pepper** | 0.885 | **DISTINCT — the alias table is wrong** |
| Sesame Oil vs Toasted Sesame Oil | 0.810 | distinct (different product) |
| Green Beans vs String Beans | 0.743 | same |
| Chili Flakes vs Red Pepper Flakes | 0.730 | same |
| Rapeseed Oil vs Canola Oil | 0.711 | same |
| Heavy Cream vs Whipping Cream | 0.703 | borderline — different fat % |
| Napa Cabbage vs Chinese Cabbage | 0.698 | same |
| Ground Pork vs Minced Pork | 0.685 | same |
| Risotto Rice vs Arborio Rice | 0.678 | same |

Every one is a judgement a person makes in seconds and a threshold gets wrong.
And the top row is the argument for the whole interlock: **without the structural
gate, blindly trusting aliases would have merged the bell peppers** — a silent,
destructive over-merge of exactly the kind you flagged.

### What it would *not* have caught

Honest gaps:

- **`Flour` (47) / `All Purpose Flour` (27)** — caught, via the
  `all-purpose flour → Flour` alias. But **`Pepper` (25) / `Black Pepper` (29)**
  is caught only because someone happened to write that alias. Neither would have
  been caught by structure or embeddings alone.
- **`Oil` (11) / `Vegetable Oil` (20)** — no alias, `BARE_VS_MOD`, goes to the
  LLM. "Oil" is a genuinely ambiguous catch-all and I would expect the LLM to
  keep it distinct, which is arguably right and still leaves a useless row.
  **A bare generic like "Oil", "Pepper" or "Rice" is a different defect** — it
  should never have been *generated*, and the fix belongs in the generator
  prompt, not the resolver.
- **The ~10 malformed rows** (`Guanciale (Or Pancetta or Bacon)`,
  `Sugar (For Sauce)`). `splitIngredientName` already strips parentheticals on
  path A — these arrived via path D, which does not. Closing D fixes them
  prospectively.

---

## 7. What I'd do, in order

| # | Step | Cost | Risk |
| --- | --- | --- | --- |
| 1 | **Fix the alias lookup** — canonical column + unique index + `.in("alias_canonical_id", …)` | one migration, one repo method | very low |
| 2 | **Widen retrieval** — `match_count: 1` → `10`, shortlist to one LLM call, structural pre-filter | one service change | low; strictly more recall |
| 3 | **Route path D through `matchIngredients`** + `resolve_ingredient` as backstop | moderate — touches `persistRecipe` | medium, wants care |
| 4 | **`ingredient_alias_collisions` as a check target** | a view + a target | none |
| 5 | **Backfill: 40 auto-merges, 10 to review** via `merge_ingredient` | one operation run | low — 3 edges at stake |
| 6 | **Nightly drift check** into `ingredient_merge_reviews` | small operation | none |

Steps 1 and 2 are most of the value and neither is risky. Step 3 is the one that
needs real thought, because it changes how every generated recipe persists.

Two things to remember afterwards, both from CLAUDE.md: **`merge_ingredient`
already exists** (`…0013_merge_functions`) so the backfill does not need new
merge logic — and after any merge, **re-run `embed-ingredients`**, since a merged
row's stale vector stays comparable to a name that no longer exists and degrades
matching silently rather than failing.

One deliberate non-recommendation: **do not add a constraint that blocks the
insert.** A `RAISE EXCEPTION` on a suspected duplicate inside `persist_recipe`
would fail the entire recipe mid-stream, turning a cosmetic catalogue problem
into a user-visible outage. Every mechanism above either resolves silently or
creates and flags.

---

## 8. Implementation notes (steps 1 & 2, 2026-08-23)

Everything below was measured by `npx nx run @fridgeezy/database:check-ingredient-identity`,
read-only against the live dev project. It masks each ingredient row in turn and
re-resolves its name against everything else, which reconstructs the moment that
name first arrived — the only moment the resolver ever gets to decide.

### 8.1 The result that matters

The comparison is deliberately **LLM-independent**, because prompt quality is a
separate variable and mixing the two makes neither measurable. A candidate that
must never merge — a sibling, or a strictly more specific row — is an
opportunity to corrupt the catalogue. The question is how often each retrieval
strategy puts one in front of the adjudicator:

| | OLD (rank-1, no filter) | NEW (top-10, filtered) |
| --- | --- | --- |
| Names offered an unmergeable candidate | **327** | **0** |
| Names where the true synonym is reachable | 24 | 29 |
| Names offered nothing at all (→ create) | 280 | 388 |

327 of 1067 names — 31% of the catalogue — were being shown a candidate the
adjudicator had to refuse. It refused nearly all of them; it took one
(`red bell pepper -> Green Bell Pepper`), and that is the wrong alias in the
table today.

The full sweep reports **0 unexpected merges** across the deterministic layers:
every name reaches its own row or a synonym the catalogue already records.

### 8.2 Named cases

```
PASS   Green Onion       -> Scallion        [alias]
PASS   Spring Onion      -> Scallion        [alias]
PASS   All Purpose Flour -> Flour           [alias]
PASS   Active Dry Yeast  -> Yeast           [alias]
PASS   Beetroot          -> Beets           [alias]
PASS   Chicken Egg       -> Egg             [alias]
PASS   Rice Flour        -> (create)        MUST stay distinct from Flour
PASS   Flour             -> (create)        the base, not swallowed
PASS   Duck Egg          -> (create)        MUST stay distinct from Egg
PASS   White Pepper      -> (create)        MUST stay distinct from Black Pepper
KNOWN  Soya Sauce        -> (create)        conservative miss
KNOWN  Red Bell Pepper   -> Green Bell Pepper   pre-existing bad alias
```

**`Soya Sauce` is a partial result and worth stating plainly.** The promise was
that it reach `Soy Sauce` and not `Sweet Soy Sauce`. Half of that holds: it no
longer reaches `Sweet Soy Sauce`, which the old rank-1 retrieval offered at
**0.871 — above the auto-accept threshold**. But it does not reach `Soy Sauce`
either, because `{soya}` vs `{soy}` is two modifiers on one head noun and the
structural rule reads that as a sibling. It creates instead, which is the safe
direction.

The fix is **data, not rule**: add the alias `soya sauce -> Soy Sauce`. Widening
the rule to catch it by edit distance would also merge `lima bean` into
`lime bean`, which is the trade this whole design refuses.

### 8.3 Two things the sweep caught that reasoning did not

Both were errors in my own first implementation, found only by running it.

**The interlock does NOT belong on the alias layer.** I applied it there first,
reasoning that fixing case-sensitivity activates ~190 previously-inert aliases
and one of them is wrong. Measured: it withheld **58 of 238 aliases**, and they
were overwhelmingly legitimate — `chilli powder -> Chili Powder`,
`minced beef -> Ground Beef`, `icing sugar -> Powdered Sugar`,
`wholemeal flour -> Whole Wheat Flour`. Spelling and regional variants that
happen to share a head noun. Withholding them re-opens the very leak the change
closes.

And the worry was unfounded: **94 aliases, the bad one included, have an
ingredient row of their own canonical id, and step 1 resolves canonical before
step 2 is reached.** An alias contradicting an existing row is unreachable by
construction. That class is exactly what `ingredient_alias_collisions` reports.

So the interlock guards the layer that GUESSES, not the layer that reads an
explicit assertion. Reverted.

**A general name must never resolve onto a more specific one.** The first LLM
sweep merged `Mayonnaise -> Kewpie Mayonnaise`, `Tempeh -> Smoked Tempeh` and
`Vermicelli -> Rice Vermicelli` — each filing a general ingredient under one
brand or variety, so every later recipe calling for plain mayonnaise gets the
Japanese one. That direction is *always* wrong, so it does not need judgement, it
needs refusing, and it is structurally detectable. `isAdjudicableCandidate` now
allows narrow→broad and refuses broad→narrow.

The asymmetry is the point: `all purpose flour` really is `flour`, and that is
decided by the curated alias list. The reverse never is.

### 8.4 What is NOT claimed

The LLM layer still merges some things it should not. Under the masked sweep it
produced ~104 merges beyond the recorded aliases; hand-reading them, most are
correct merges of rows that are genuinely duplicates (`Sage`/`Sage Leaves`,
`Crayfish`/`Crawfish`, `Cilantro`/`Coriander`, `Gruyère Cheese`/`Gruyere`) and a
minority are wrong (`Smoked Paprika -> Paprika`, `Black Cardamom -> Cardamom`,
`Coriander Leaves -> Coriander`).

Three honest qualifications:

- I tightened that prompt **three times** and stopped. Continuing would be
  tuning until the number looked acceptable, which is the failure mode this
  design exists to avoid. The structural guarantees above hold regardless of
  what the model does; the prompt is a second line, not the mechanism.
- The masked sweep is **harsher than production**. It strips a row's own
  identity and forces a decision among its near neighbours — including its own
  existing duplicates. In production, layer 3 is reached only by a name with no
  canonical row and no alias.
- The residual failures are concentrated in `BARE_VS_MOD` (`Smoked Paprika` vs
  `Paprika`), the class the structural rule deliberately declines to decide.
  Tightening that further means either a semantic rule or a review queue — §9.

### 8.5 Migration correctness

Validated against local Postgres inside a rolled-back transaction, using data
reproducing the real conflict shapes. Testing found a defect reasoning missed:
the first version dropped only self-aliases, which happens to be sufficient on
the current remote data and would fail on any database holding a same-target
case-variant pair (`Green Onion` beside `green onion`). It now also collapses
those, and **raises rather than guessing** if any surviving canonical group maps
to two different ingredients:

```
ERROR: ingredient_aliases: canonical ids map to more than one ingredient
       (protein_thing). Resolve by hand before migrating.
```

That guard is deliberate. "Keep the oldest" applied to two real, differing
mappings picks one silently, and picking wrong writes a bad merge into the table
every later lookup trusts.

---

## 9. The 10 contradictions — what actually happens to them

The check prints them on every run:

```
"steak"             -> Beef Steak        "toasted sesame oil" -> Sesame Oil
"pepper"            -> Black Pepper      "stock cube"         -> Bouillon Cube
"red pepper flakes" -> Chili Flakes      "minced pork"        -> Ground Pork
"whipping cream"    -> Heavy Cream       "string bean"        -> Green Beans
"chinese cabbage"   -> Napa Cabbage      "rapeseed oil"       -> Canola Oil
"risotto rice"      -> Arborio Rice      "red bell pepper"    -> Green Bell Pepper
```

**Today they are surfaced but not tracked**, and you are right that this is the
part that otherwise rots. Two things exist now, and one does not:

- `ingredient_alias_collisions` (view, shipped) — the exact, LLM-free query.
  Returns 50 rows today; should trend to zero after cleanup. A non-empty result
  *afterwards* means a write path is still bypassing alias resolution.
- `check-ingredient-identity` (shipped) — prints the contradictions and exits
  non-zero on a real regression, so it can gate CI.
- **A durable record of human verdicts — NOT built.** This is the gap.

### What I would build, when the cleanup runs

`ingredient_merge_reviews`, as sketched in §4.1(c): one row per unordered pair,
`status pending|merged|distinct`, `unique (ingredient_a, ingredient_b)` and a
`ingredient_a < ingredient_b` check so a pair cannot be queued twice in opposite
orders.

The load-bearing property is that **a `distinct` verdict is sticky**. Without
that, the nightly check re-raises `Green Bell Pepper vs Red Bell Pepper` every
night forever, someone learns to ignore the report, and the one row that
genuinely needs attention is buried under twelve that do not. A review queue
nobody trusts is worse than no queue, because it looks like coverage.

It is deliberately not built yet: with 10 pairs and no cleanup run, a table
would be ceremony around a list that fits on one screen. Build it **with** the
backfill, not before — that is the first moment a verdict needs to outlive a
terminal session.

---

## 10. What this changes for `dedupe-ingredients`

Materially, and mostly by making it cheaper and safer.

**It should now run against a much shorter list.** `dedupe-ingredients` today
scans the catalogue and costs ~5N LLM calls. The 50 rows in
`ingredient_alias_collisions` are duplicates *by construction* — no embedding,
no model, no judgement — so they should be merged directly and never enter the
LLM audit at all. That is the bulk of the real duplication (`All Purpose Flour`
27 uses, `Pepper` 25, `Panko Breadcrumbs` 9, `Green Peas` 9).

**Its dangerous class is now nameable.** It should adopt
`isAdjudicableCandidate` from `@fridgeezy/toolkit` — the same function the write
path uses, so the audit and the resolver cannot disagree about what a sibling
is. Anything it would merge that the interlock calls a sibling goes to review
rather than to the model.

**Three ordering constraints, all of which bite:**

1. **Run the migration first.** It deletes 44 inert self-aliases and collapses
   case-variant duplicates. Deduping before that means adjudicating pairs that
   the migration is about to make moot.
2. **Merge the alias collisions before the LLM pass.** Otherwise the model is
   asked about `Flour` vs `All Purpose Flour` — a question the alias table
   already answers, at gpt-4o-mini prices, with a chance of answering it wrong.
3. **Re-run `embed-ingredients` after any merge.** Per CLAUDE.md a merged row's
   stale vector stays comparable to a name that no longer exists, degrading
   matching silently rather than failing. This now matters more, not less: the
   resolver reads ten neighbours instead of one, so a stale vector has ten times
   the chance of landing in a shortlist.

**One thing it must NOT do**: merge `Red Bell Pepper` into `Green Bell Pepper` on
the strength of the alias. That alias is wrong, it was learned at runtime on
2026-07-29 by the old single-candidate adjudicator, and the correct cleanup is to
**delete the alias**, not to act on it. It is the clearest evidence in the
catalogue that this table needs the same scepticism as a model verdict.
