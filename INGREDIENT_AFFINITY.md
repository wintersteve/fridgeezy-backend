# Ingredient affinity, and whether a graph database earns its place

**Status:** analysis + design. Nothing implemented.
**Date:** 2026-08-23.
**Measured against:** the live dev project `qkxznjwlybjqpcauaisz`, read-only.
The local stack was up but holds 0 recipes and 38 ingredients, so every number
below comes from the remote. No writes were made.

---

## 0. The numbers everything else follows from

| | |
| --- | --- |
| Dishes (catalogue recipes + suggestions, variants collapsed) | **291** |
| — of which recipes (`created_by is null`) | 50, collapsing to **33** distinct dishes (17 are variants) |
| — of which suggestions | 250 |
| Ingredient rows | 1067 |
| — that appear in at least one dish | **468** (599, or **56%**, are seed rows with no edge) |
| Dish→ingredient edges | 2469 |
| Mean ingredients per dish | 8.48 (min 2, max 20) |
| Pair instances | 10,665 |
| Distinct co-occurring pairs | ~5,470 — **73% of them occur exactly once** |
| Pairs surviving `support >= 3` | **798** |

Growth: 275 of the 300 dishes arrived in a single burst on 2026-08-02. Organic
growth since is 5–10 dishes/day, and the `profile_prompts` contents show that
traffic is still you testing. **This is a pre-launch dev catalogue**, and that
fact drives most of the verdicts below.

---

## 1. The graph DB question

### Verdict: you're right, and by a wider margin than you argued — but half your reasoning defends something that doesn't exist here.

**The half that's right, with a number.** The complete NPMI affinity
computation — build the bipartite edge set, self-join it, compute degrees,
score every pair — over the *entire* catalogue:

```
Execution Time: 32.643 ms
Buffers: shared hit=288        (~2.3 MB, zero disk reads)
```

The whole working set fits in L3 cache. This is not a query that needs a
different database; it is a query that needs a `GROUP BY`. And it is a nightly
materialized-view refresh, not a request-path read, so even a 100× catalogue
(≈1–2 s, see §3.4) changes nothing about the architecture.

**The half that's wrong.** You defended recursive CTEs for "the genuinely
graph-shaped cases." There are no genuinely graph-shaped cases in this schema —
not because Postgres would struggle, but because **nothing recursive is
persisted**:

| Candidate recursive structure | Reality |
| --- | --- |
| `ingredients.parent_id` | **5 rows total.** The deepest chain in the database is Chicken Egg → Duck Egg → Salted Egg. Three nodes. |
| `recipes.base_recipe_id` | 17 rows, and depth is **1 by construction** — `resolveVariantBase` points a new variant at its source's *base*, never at the source. CLAUDE.md: "Families stay flat." |
| `ingredient_substitutes` | **Does not exist.** Dropped before the consolidated baseline (`MIGRATIONS.md:49`). |
| `ingredient_pairings` | **Also dropped**, already gone from the live database. |

So the traversal you were defending is depth-2 and fixed —
ingredient → dish → ingredient — which is a self-join. The bipartite
aggregation isn't *one* of the workloads; it's the whole workload.

Note the irony in that `parent_id` chain: its root, "Chicken Egg", is itself a
duplicate of "Egg", the catalogue's fourth most-used ingredient (87 uses). The
one hierarchy in the schema is rooted on a fragmentation bug.

**Someone already tried this.** `ingredient_pairings` and
`ingredient_substitutes` were both tables at some point and both were dropped as
unused. Worth knowing before rebuilding either.

### What would actually justify a graph DB

The honest form of the test: a graph database earns its place when **traversal
depth is unbounded and fan-out is data-dependent**, so the query planner cannot
know how many joins it will need. Nothing here is that shape, and nothing on the
roadmap becomes it. The nearest candidate would be a persisted substitution
graph with transitive strength decay traversed to arbitrary depth — and §4.2
concludes you should not build that graph at all, for reasons unrelated to
storage.

Even if you did: at 10⁵ edges you'd reach for a recursive CTE first and it would
be fine.

**Cost of being wrong is near zero**, which is worth saying plainly. The affinity
table is a *derived artifact* — recomputable from the base tables in 32 ms. If
this analysis is wrong you rebuild it somewhere else in an afternoon. Don't
over-think the decision.

---

## 2. The finding that matters more than the graph question

You asked me to flag it plainly if the data was messier than assumed, because
affinity over unnormalised strings is garbage. **It is not that bad — but it is
not clean either, and the distinction is worth stating precisely.**

### Structurally: clean. Genuinely.

```sql
recipe_ingredients.ingredient_id  uuid NOT NULL REFERENCES ingredients(id)
  UNIQUE (recipe_id, ingredient_id)
recipe_suggestion_ingredients.ingredient_id  uuid NOT NULL REFERENCES ingredients(id)
```

There is **no free-text ingredient anywhere in the join tables**. Every edge is
a foreign key to a real entity. The failure mode you were worried about — "1 tbsp
finely chopped garlic" as a distinct string from "garlic" — cannot occur.

### Entity-level: fragmented. Confirmed, not suspected.

The `ingredients` table itself holds multiple rows for one real-world thing:

| Concept | Split across (uses) |
| --- | --- |
| Flour | Flour (47) / All Purpose Flour (27) |
| Pepper | Pepper (25) / Black Pepper (29) / White Pepper (9) — "Pepper" is an ambiguous catch-all |
| Scallion | **Scallion (34) / Green Onion (4) / Spring Onion (3)** |
| Oil | Oil (11) / Vegetable Oil (20) / Sunflower Oil (7) — "Oil" is a catch-all |
| Soy sauce | Soy Sauce (48) / Soya Sauce (2) / Light Soy Sauce (2) |
| Beetroot | Beetroot (4) / Red Beets (3) / Beets (0) |
| Coriander leaf | Coriander (6) / Cilantro (4) |
| Egg | Egg (87) / Chicken Egg |
| Rice | Rice (3) / Cooked Rice (4) |
| Yeast | Yeast / Active Dry Yeast |
| Parmesan | Parmesan / Parmesan Cheese (cos 0.949) |
| Ricotta | Ricotta / Ricotta Cheese (0.944) |
| Turmeric | Turmeric / Turmeric Powder (0.881) |
| Pita | Pita / Pita Bread (0.874) |

Scallion / Green Onion / Spring Onion is worth calling out: that is *verbatim*
the example CLAUDE.md gives when describing the `dedupe-ingredients` audit
("when the catalog visibly holds two names for one thing"). The catalogue
visibly holds three, and the audit has not been run.

Plus ~10 rows (≈1%) that are recipe-line fragments promoted to entities:
`Guanciale (Or Pancetta or Bacon)`, `Lard or Butter`, `Sugar (For Sauce)`,
`Turmeric (Optional, for Color)`, `Beef (Brisket or Sirloin)`.

And the `category_id` axis is inconsistent where it does exist: Salted Butter is
`Dairy`, Unsalted Butter is `Fats & Oils`, Truffle Butter is `Mushrooms`.

### How much does this actually hurt? Less than you'd fear, and in the benign direction.

**Fragmentation splits support; it does not invent pairs.** A pair whose support
is divided between "Flour" and "All Purpose Flour" falls below the `support >= 3`
floor and gets **dropped**. So the failure mode is *recall* — affinity you should
have found and didn't — not *garbage* — affinity that is wrong. Nothing in the
top-30 NPMI list in §3 is a fragmentation artifact.

That asymmetry is what makes the affinity feature shippable today and the
shopping nudge not:

| Feature | Blocked by fragmentation? |
| --- | --- |
| Affinity / "goes well with" | **No.** Costs some recall, produces nothing wrong. |
| Shopping nudge (§4.1) | **Yes, visibly.** Its real output listed "Yeast" and "Active Dry Yeast" as two separate things to buy. |
| Prompt integration (§4.3) | No — it consumes the affinity table. |

---

## 3. Ingredient affinity — the core feature

### 3.1 The problem, demonstrated

Raw co-occurrence, top 20 — exactly the disappointment you predicted:

```
Salt + Onion          51     Butter + Sugar        33
Garlic + Salt         48     Olive Oil + Onion     32
Garlic + Onion        42     Salt + Tomato         32
Olive Oil + Salt      39     Butter + Egg          31
Egg + Salt            39     Olive Oil + Tomato    30
Onion + Tomato        36     Salt + Flour          26
Garlic + Tomato       36     Salt + Sugar          25
Olive Oil + Garlic    35     Egg + Sugar           24
Butter + Salt         34     Potato + Onion        23
Egg + Flour           34     Salt + Pepper         23
```

Pure staple soup. Not a feature.

### 3.2 The scoring, and actual output

**NPMI (normalised pointwise mutual information), floor `support >= 3`.**

```
npmi(x,y) = ln( p(x,y) / (p(x)·p(y)) ) / −ln p(x,y)
```

Top 30, real data, `sup` = dishes containing both, `cx`/`cy` = each ingredient's
dish count:

| pair | sup | cx | cy | npmi |
| --- | --- | --- | --- | --- |
| Bonito Flakes + Dashi | 4 | 4 | 4 | 1.000 |
| Chili Powder + Kidney Beans | 6 | 6 | 8 | 0.925 |
| Sunflower Oil + Green Peas | 6 | 7 | 9 | 0.854 |
| Turmeric + Garam Masala | 5 | 9 | 5 | 0.853 |
| Cheddar Cheese + Chili Powder | 3 | 3 | 6 | 0.846 |
| Chili Powder + Beef Broth | 3 | 6 | 3 | 0.846 |
| Chashu Pork + Ramen Noodle | 3 | 3 | 6 | 0.846 |
| Cooked Rice + Chili Flakes | 4 | 4 | 8 | 0.836 |
| Kimchi + Cooked Rice | 4 | 8 | 4 | 0.836 |
| Garam Masala + Coriander Powder | 3 | 5 | 4 | 0.823 |
| Beetroot + Dill | 3 | 4 | 5 | 0.823 |
| Green Chili + Garam Masala | 4 | 7 | 5 | 0.815 |
| Red Beets + Sunflower Oil | 3 | 3 | 7 | 0.812 |
| Turmeric + Coriander Powder | 4 | 9 | 4 | 0.808 |
| Sunflower Oil + Pickles | 6 | 7 | 11 | 0.801 |
| Kimchi + Gochujang | 6 | 8 | 10 | 0.791 |
| Cooked Rice + Gochujang | 4 | 4 | 10 | 0.783 |
| Lemon Zest + Powdered Sugar | 3 | 6 | 4 | 0.783 |
| Panko Breadcrumbs + Tonkatsu Sauce | 3 | 8 | 3 | 0.783 |
| Laksa Leaf + Coconut Milk | 3 | 3 | 8 | 0.783 |
| Gochujang + Shiitake Mushrooms | 5 | 10 | 6 | 0.781 |
| Squid + Shrimp | 5 | 6 | 11 | 0.758 |
| Cinnamon Stick + Cloves | 3 | 3 | 9 | 0.757 |

**Eyeball verdict: this reads as real cooking.** Korean (kimchi/gochujang/rice),
Indian (garam masala/turmeric/coriander), Japanese (dashi/bonito,
panko/tonkatsu), borscht (beetroot/dill, red beets/sunflower oil), laksa,
mulling spices, baking (lemon zest/powdered sugar). Not one staple pair survives.

### 3.3 Two honest caveats about that list

**(a) It is substantially recovering *cuisine*, not *flavour affinity*.**
"Gochujang + Shiitake Mushrooms" scores high because both are Korean-dish
markers in a 291-dish catalogue, not because they are a celebrated pairing. At
this size, "these appear in the same cuisine" and "these go together" are not
separable. That's fine for the shipping use case ("goes well with" on an
ingredient page) and it is *not* fine as a claim about gastronomy.

**(b) Near-duplicate dishes inflate the top of the list.** `Bonito Flakes +
Dashi` scores a perfect 1.000 off 4 dishes — which are Okonomiyaki, Negiyaki,
**Modanyaki with Seafood**, and Agedashi Tofu. Three of those four are the same
dish family. Collapsing `base_recipe_id` handles the 17 recipe variants, but
**suggestions have no family link** — CLAUDE.md records "No dish-family
(`parent_dish`) link" as a deliberate gap, and this is a second, mild cost of it.

Mitigation for v1: none needed beyond the support floor. Revisit if a
`parent_dish` link ever lands.

### 3.4 Why NPMI and not the alternatives

| | Why not |
| --- | --- |
| Raw count | Demonstrated above. Staples. |
| PMI | Unbounded, and maximised by ultra-rare pairs. With **73% of pairs at support 1**, an unfloored PMI ranking is a list of accidents. |
| Lift | Same rare-pair pathology, different scale. |
| Jaccard | Defensible, but penalises pairs with very different marginals — it would suppress exactly the "rare spice + common base" pairs (Laksa Leaf + Coconut Milk) that are the most interesting output. |
| **NPMI + support floor** | Bounded [−1, 1], so thresholds are portable as the catalogue grows. The floor is what buys back PMI's rare-pair problem. |

The support floor is the load-bearing parameter, not the metric. At `>= 3` you
keep 798 of ~5,470 pairs. **`>= 3` is a judgement, not a fitted value** — there
is no held-out distribution to fit it against, so per CLAUDE.md's convention it
is safe to move by hand and does *not* want a `calibrate*` target.

### 3.5 Where it lives, and what it costs

**A materialized view, refreshed nightly by `pg_cron`.** Not a table, not a
request-path query, not a trigger.

```sql
create materialized view ingredient_affinity as
with dish_ing as (
  -- variants collapse onto their base, so a modified dish is counted once
  select coalesce(r.base_recipe_id, r.id) as dish_id, ri.ingredient_id
  from recipes r
  join recipe_ingredients ri on ri.recipe_id = r.id
  where r.created_by is null              -- catalogue only; imports are private
  union
  select s.id, si.ingredient_id
  from recipe_suggestions s
  join recipe_suggestion_ingredients si on si.recipe_suggestion_id = s.id
),
n   as (select count(distinct dish_id)::numeric v from dish_ing),
deg as (select ingredient_id, count(distinct dish_id)::numeric c
        from dish_ing group by 1),
pairs as (
  select a.ingredient_id x, b.ingredient_id y, count(*)::numeric sup
  from dish_ing a
  join dish_ing b on a.dish_id = b.dish_id and a.ingredient_id < b.ingredient_id
  group by 1, 2
)
select p.x as ingredient_a, p.y as ingredient_b, p.sup::int as support,
       ln((p.sup * (select v from n)) / (dx.c * dy.c))
         / (-ln(p.sup / (select v from n))) as npmi
from pairs p
join deg dx on dx.ingredient_id = p.x
join deg dy on dy.ingredient_id = p.y
where p.sup >= 3;

-- REFRESH CONCURRENTLY requires this
create unique index ingredient_affinity_pair_key
  on ingredient_affinity (ingredient_a, ingredient_b);
create index ingredient_affinity_a_npmi
  on ingredient_affinity (ingredient_a, npmi desc);
create index ingredient_affinity_b_npmi
  on ingredient_affinity (ingredient_b, npmi desc);
```

The view is one-directional (`a < b`); the two indexes are what let a lookup
find pairs from either side without storing both orders.

**Refresh: `REFRESH MATERIALIZED VIEW CONCURRENTLY ingredient_affinity`, nightly.**

- `pg_cron` is already an extension (`…0001_extensions_and_enums`) and there is
  already one scheduled job, so this adds a line, not a dependency.
- `CONCURRENTLY` means readers never block. It needs the unique index above.
- **Do not refresh on write.** 130 dishes landed on 2026-08-02; a write trigger
  would have recomputed the whole view 130 times that day for a result nobody
  read. The data tolerates unlimited staleness — it is a discovery ranking and a
  prompt prior, not a correctness-bearing read.

**Cost:**

| | |
| --- | --- |
| Refresh today | **32.6 ms**, 2.3 MB buffers, no disk |
| Rows today | 798 |
| At 10,000 dishes | ≈1–2 s. The self-join is O(Σ k²) — linear in dish count at fixed k ≈ 8.5 — and only the distinct-pair `GROUP BY` grows faster, until it saturates. |
| At 100,000 dishes | tens of seconds. Still trivially a nightly job. |
| Storage at 10k dishes | order 10⁵ rows, single-digit MB |
| Marginal LLM spend | **zero** — this touches no model |

The point worth holding onto: **the refresh is cheaper than one recipe image**
(~$0.14) by an unbounded margin, because it costs no external call at all.

---

## 4. The three features on top

### 4.1 Ranking ingredients by recipes unlocked — DEFER, with numbers

Prototyped against a generous fridge (chicken, onion, garlic, egg, soy sauce,
rice, carrot, ginger) plus 11 assumed staples (salt, water, pepper, sugar, oils,
flour, butter). "Unlocks" = dishes for which this is the *last* missing
ingredient.

```
buy_this            unlocks_n_dishes
Scallion            2
Active Dry Yeast    1
Apples              1
Ghee                1
Potato              1
Yeast               1
```

**The best possible purchase unlocks two dishes.** And note the output lists
`Yeast` and `Active Dry Yeast` as separate suggestions — fragmentation reaching
the user directly.

Why it's thin — the reachability distribution:

| still missing | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| dishes | **7** | 25 | 47 | 36 | 45 | 34 |

Only 7 dishes in the entire catalogue sit one ingredient away. With 8.48
ingredients per dish and 291 dishes, "missing exactly one" is a rare event. This
is a catalogue-size problem, not a query problem.

**A second blocker: there is no persisted fridge.** `pantry_items` was dropped
(`MIGRATIONS.md`, "Deliberately dropped" — unused by client and backend).
`GenerateSuggestionRequestSchema` takes:

```ts
ingredients: z.array(z.string()).optional(),
```

— free-text strings, per request, never stored. So this feature has no standing
input. It would have to take the fridge from the request body and resolve
strings → ingredient ids through the same `matchIngredients` path, on every call.

**Verdict: defer.** It needs (a) dedup fixed, (b) a substantially larger
catalogue, and probably (c) a persisted pantry — which is a product decision,
not a backend one.

**The better feature at this size** is the same query read the other way: *"3
dishes are one ingredient away"* — 7 such dishes exist, and that is a real,
honest, useful screen today. It needs no scoring at all.

### 4.2 Multi-hop substitution — DON'T BUILD (but keep the machinery)

**There is no substitution graph to walk.** `ingredient_substitutes` was dropped;
substitutes are LLM-generated per request by `/rest/substitutes/generate` and
never persisted. So multi-hop substitution requires first *manufacturing* the
1-hop edges. I tested both ways of doing that. Both fail.

**Candidate 1 — embedding kNN. Fails: lexical, not functional.**
Nearest neighbours of `Butter` by cosine over the existing 1536-d embeddings:

```
Salted Butter      0.640        Clarified Butter   0.590
Plant-Based Butter 0.623        Butter Bean        0.567   ← a legume
Truffle Butter     0.618        Buttermilk         0.553
Unsalted Butter    0.615        Bread              0.539   ← co-occurs in text
Vegan Butter       0.606        Honey              0.506
Lard or Butter     0.603        Ghee               0.506   ← the real substitute, ranked 12th
```

**Butter Bean outranks Ghee.** Text embeddings encode *name similarity*;
substitution is a claim about *role in a dish*. Different relation.

**Candidate 2 — distributional similarity (PPMI context vectors over
co-occurrence). Fails: recovers cuisine, not role.** Top hits:

```
Chili Powder <-> Kidney Beans   ctx_sim 0.861   co-occur 6×
Soy Sauce    <-> Sesame Oil     ctx_sim 0.817   co-occur 19×
Scallion     <-> Soy Sauce      ctx_sim 0.774   co-occur 21×
```

The `co-occur` column is the tell: **real substitutes should co-occur rarely** —
you use one *or* the other. These are cuisine markers.

Adding the correct filter (`observed co-occurrence < half of expected`) improves
it markedly:

```
Paprika        <-> Smoked Paprika      0.539   ✓ real substitute
Active Dry Yeast <-> Yeast             0.531   ✓ …but a DUPLICATE
Black Pepper   <-> Pepper              0.470   ✓ …DUPLICATE
Brown Sugar    <-> Sugar               0.425   ✓ real substitute
Oregano        <-> Thyme               0.422   ✓ real substitute
Walnuts        <-> Almonds             0.415   ✓ real substitute
Bell Pepper    <-> Green Bell Pepper   0.400   ✓ …DUPLICATE
Ghee           <-> Oil                 0.399   ✓ real substitute
Phyllo Dough   <-> Lemon Zest          0.496   ✗
Lemon Zest     <-> Semolina            0.493   ✗
Milk           <-> Walnuts             0.470   ✗
Breadcrumbs    <-> Nutmeg              0.409   ✗
```

≈⅓ precision, and **half the correct hits are duplicates rather than
substitutes**.

**Three reasons that settles it:**

1. **Multi-hop compounds error.** Two hops over a ⅓-precision relation is ≈⅑.
   Multi-hop is only worth building on top of a 1-hop relation you trust.
2. **The product already answers this better.** `/substitutes/generate` asks an
   LLM, which carries vastly stronger substitution priors than 291 dishes can
   supply. A worse answer derived from thin local data is a regression.
3. **The premise is rare.** Multi-hop is for "nothing in the fridge substitutes
   directly, but something two steps out does." Given §4.1 — only 7 dishes are
   even one ingredient from complete — that situation is not the bottleneck.

**But keep the query — repurpose it.** That distributional method is a poor
substitute-finder and a *good duplicate detector*: it independently surfaced
Yeast/Active Dry Yeast, Pepper/Black Pepper, and Bell Pepper/Green Bell Pepper,
several of which the embedding similarity missed. §2 says fragmentation is the
real problem; CLAUDE.md says `dedupe-ingredients` "costs ~5N LLM calls."

**Feed this query to `dedupe-ingredients` as its candidate generator.** It turns
an O(5N) LLM audit into an adjudication of a few dozen shortlisted pairs. The
failed feature's machinery solves the actual blocker — that's the most valuable
thing in this section.

### 4.3 Affinity into generation prompts — build it, but discriminatively

The best of the three, and the cheapest, since it consumes the table §3 already
builds. Three constraints, one of which is a genuine design risk.

**(a) It goes in the USER prompt, never the system prompt.** CLAUDE.md is
explicit: on Bedrock there is exactly one `cache_control` breakpoint, on
`system`, and "nothing volatile may move above it." Affinity content varies per
request (it depends on the requested cuisine and ingredients), so putting it in
`system` invalidates the cache on every call — paying the ~1.25× write premium
for a read that never comes. This is the same reason `promote` feeds
`total_time_minutes` into the *user* prompt as an anchor.

**(b) Circularity — the real risk, and the reason to be careful.** The catalogue
was generated by the model. Affinity computed over 291 model-generated dishes is
substantially *a measurement of the model's own priors, laundered through a
database*. Feeding it back into the generator tells the model what it already
thinks and reinforces it — narrowing the catalogue onto its existing patterns
rather than grounding it in real cooking. §3.3(a) sharpens this: the signal is
largely cuisine co-membership, so the loop would tighten cuisine clustering
specifically.

This is not fatal, but it changes the recommended use:

> **Use affinity discriminatively (verify, rank, retrieve), not generatively
> (instruct).** A discriminative use degrades gracefully — a bad affinity score
> mis-ranks a candidate. A generative use compounds — a bad affinity prior
> becomes tomorrow's training signal for the next affinity computation.

The strongest first application is therefore **ranking retrieved catalogue
dishes** and supporting the existing dedup/authenticity path, not adding a
"these ingredients pair well" block to the three generators.

**(c) Measure it.** `eval-chat-routing` and the `calibrate*` targets exist
precisely because prompt changes here fail silently and plausibly. Any generator
prompt change wants a run before and after.

### 4.4 `profile_prompts` as a second affinity signal — no, and not close

**Volume: 20 rows, 1 profile, 2 days.** The contents settle it:

```
"Give me a pad kraw pao recipe"     ×4 consecutive
"Test"                              ×2
"Give me a laksa recipe Michelin leebl"
"Can you give me a bak kuh teh recope"
"It's still not beef"
```

That is you testing the chat surface, not a corpus.

**But volume is the lesser problem — it's the wrong shape.** These are *dish*
requests ("give me a carbonara recipe"), not ingredient statements. Extracting
ingredient affinity would mean resolving prompt → dish → ingredients, which
re-derives the catalogue's own affinity weighted by request frequency. That is a
**popularity signal, not an affinity signal** — and `profile_taste_signals` is
already the purpose-built table for preference (2 rows).

**When it would be worth revisiting:** when prompts capture *ingredient-level*
intent at volume — "what can I do with leftover fennel", "something with the
chicken thighs". Rough threshold: order 10⁴ prompts across 10² distinct
profiles. You are three orders of magnitude away, and the table is 1 day old.

None of which is a criticism of the table — it was built for prompt history, and
for that it needs no volume at all.

---

## 5. The smallest version worth shipping

**One materialized view, one cron line, one read. Nothing else.**

1. **Migration** — the `ingredient_affinity` MV from §3.5, its unique index, its
   two lookup indexes, and a `pg_cron` nightly `REFRESH … CONCURRENTLY`.
2. **One surface** — *"Goes well with"* on the ingredient detail page. The
   client reads the view straight through PostgREST; `ingredients` is already
   `public_read`, and CLAUDE.md endorses direct PostgREST reads over a REST route
   for exactly this kind of plain list.
3. **Nothing else.** No API route, no LLM call, no write path, no new schema in
   `libs/schemas`, and therefore **no client tarball rebuild** — which is the
   step CLAUDE.md warns is manual and easy to forget.

Explicitly *not* in v1: prompt integration, unlock ranking, substitution,
`profile_prompts`.

Ship risk is close to zero: a materialized view is derived data. If the output
disappoints, `drop materialized view` and nothing else in the system notices.

### Sequencing after that

| # | Step | Gate |
| --- | --- | --- |
| 1 | Affinity MV + "goes well with" | none — ship it |
| 2 | Run `dedupe-ingredients`, using §4.2's distributional query as candidate generator | do this before *any* user-facing ingredient list |
| 3 | "One ingredient away" screen (§4.1, read the other way) | after 2 |
| 4 | Affinity into retrieval/ranking — discriminative use only (§4.3) | after 2; measure with the existing evals |
| 5 | Unlock ranking proper | needs a bigger catalogue + a persisted pantry decision |
| 6 | Multi-hop substitution | **not on current evidence** |

**And one thing that isn't a feature but outranks most of them:** after any
ingredient merge, `embed-ingredients` must be re-run, and per CLAUDE.md a merged
or renamed row's stale vector "stays comparable — just to a name that no longer
exists, which degrades dedup silently instead of failing."

---

## Appendix: reproducing the numbers

All queries are read-only and run against the live dev project. The shared
`dish_ing` CTE is the one in §3.5.

- **§0 counts** — `select count(*)` per table; orphan count is the
  `not exists` against both join tables.
- **§3.1 raw pairs** — `dish_ing` self-joined on `dish_id` with
  `a.ingredient_id < b.ingredient_id`, `order by count(*) desc`.
- **§3.2 NPMI** — as in the MV definition.
- **§3.5 timing** — `explain (analyze, buffers)` over the full MV body.
- **§4.1 unlock** — `dish_ing` minus staples minus fridge, grouped per dish,
  filtered to `count(*) = 1`.
- **§4.2 embeddings** — `order by i.embedding <=> (select embedding from
  ingredients where canonical_id = 'butter')`.
- **§4.2 distributional** — PPMI-weighted context vectors, cosine over shared
  contexts, then `observed < 0.5 × expected` co-occurrence.
