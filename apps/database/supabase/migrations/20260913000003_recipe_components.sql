-- "Which dishes are BUILT ON this component" becomes a query.
--
-- THE GAP
-- `20260823000002` made a component knowable from the INGREDIENT side: an
-- ingredient row can say "I am a dish in disguise, and my recipe is called X"
-- (`component_kind = 'dish'`, `component_dish`). That answers "can I make this
-- myself" and powers the client's Make-it-yourself marker.
--
-- The reverse — "show me dishes that USE a béchamel" — has never been
-- answerable, and not for want of a join. Recipes DECOMPOSE their components:
-- measured on both databases 2026-09-13, Moussaka lists Unsalted Butter, Flour,
-- Whole Milk, Nutmeg and Egg Yolk, and nothing named béchamel at all. So
-- `recipe_ingredients` where `ingredient_id = <Bechamel Sauce>` returns ZERO
-- rows, on a catalogue where several dishes are built on one. That is what made
-- "give me a recipe with Béchamel" unanswerable from the catalogue — every such
-- request had to be paid for as a fresh generation.
--
-- Some components ARE listed directly (Chicken Stock appears in 3 local
-- recipes), which is why the read below is a UNION rather than a new table
-- alone: the implicit half already works and must keep working.
--
-- WHY THIS IS ADDITIVE, AND WHY IT IS NOT AN INGREDIENT ROW
--
-- The obvious shape is to let a recipe list "Béchamel Sauce" among its
-- ingredients instead of the butter, flour and milk. It is wrong in both
-- directions, and each consumer of `recipe_ingredients` says so:
--
--   * `recipe_dietary` is `NOT EXISTS (… i.dietary_classified_at IS NULL OR
--     i.dietary_properties && d.forbidden)`. REPLACING the raw lines loses the
--     dairy, so the dish silently reads as vegan-safe; ADDING a line keeps the
--     dairy but makes the recipe vanish from EVERY dietary filter the moment
--     the component itself is unclassified. Both are silent.
--   * The shopping list is built from `recipe_ingredients` rows
--     (`use-everything-to-buy`). Nobody buys a béchamel. Replacing makes the
--     list unbuyable; adding puts a phantom line beside the three real ones.
--   * `find_recipes`' `p_pantry` ranks on ingredient overlap. A component is
--     not in anybody's fridge, so an extra row is a permanent "missing" that
--     pushes every dish built on a component down the feed.
--   * `find_near_miss_recipes` counts DISTANCE over the same rows. An extra row
--     inflates the distance; a replaced one hides the dairy that made the dish a
--     near miss in the first place.
--
-- So the ingredient list keeps meaning exactly what it meant — the things you
-- buy and put in a bowl — and the component declaration lives beside it. This
-- is a statement ABOUT the recipe, not a line IN it.
--
-- The consequence worth knowing: the two are not kept in sync, and must not be.
-- A recipe that declares Béchamel and lists butter, flour and milk is CORRECT,
-- and nothing should "reconcile" them by deleting either side.

create table if not exists public.recipe_components (
    recipe_id uuid not null references public.recipes(id) on delete cascade,
    ingredient_id uuid not null references public.ingredients(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (recipe_id, ingredient_id)
);

create table if not exists public.recipe_suggestion_components (
    recipe_suggestion_id uuid not null
        references public.recipe_suggestions(id) on delete cascade,
    ingredient_id uuid not null references public.ingredients(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (recipe_suggestion_id, ingredient_id)
);

-- The lookup direction this whole migration exists for: given a component, find
-- the dishes. Both tables are read that way and never by recipe.
create index if not exists idx_recipe_components_ingredient
    on public.recipe_components using btree (ingredient_id);

create index if not exists idx_recipe_suggestion_components_ingredient
    on public.recipe_suggestion_components using btree (ingredient_id);

comment on table public.recipe_components is
    'Which components a dish is BUILT ON. Additive to recipe_ingredients, never a replacement for it — the ingredient list keeps listing the butter, flour and milk. See the migration header for what breaks if a component is written as an ingredient row instead.';

-- RLS mirrors the ingredient tables exactly: a recipe component resolves
-- through its parent recipe (so an imported, owned recipe keeps its components
-- private), a suggestion component is public because suggestions are.
alter table public.recipe_components enable row level security;
alter table public.recipe_suggestion_components enable row level security;

drop policy if exists public_read on public.recipe_components;
create policy public_read on public.recipe_components
    for select using (
        exists (
            select 1 from public.recipes r
            where r.id = recipe_components.recipe_id
              and public.recipe_is_visible(r.created_by)
        )
    );

drop policy if exists public_read on public.recipe_suggestion_components;
create policy public_read on public.recipe_suggestion_components
    for select using (true);

-- No write policy, on purpose, and the revoke is not redundant: with RLS on and
-- no policy, an UPDATE or DELETE matches zero rows and returns 204, so a stale
-- client writer fails SILENTLY. Every write goes through the service role.
revoke insert, update, delete on public.recipe_components from anon, authenticated;
revoke insert, update, delete on public.recipe_suggestion_components from anon, authenticated;

/**
 * Every (dish, component) pair, explicit and implicit.
 *
 * The implicit half is the ingredient rows that ARE components
 * (`component_kind = 'dish'`), which is how the link works today for the
 * recipes that happen to name one. Reading the union means a recipe never needs
 * BOTH — declaring a component it already lists is harmless but pointless, and
 * the `union` de-duplicates it either way.
 *
 * SECURITY INVOKER so it sees the policies above rather than past them. Note
 * the contrast with `recipe_display_tags`, which does not — that is a known and
 * recorded exception, not a pattern to copy.
 */
create or replace view public.dish_components
with (security_invoker = true) as
    select rc.recipe_id as dish_id, 'recipe'::text as source, rc.ingredient_id
    from public.recipe_components rc
union
    select ri.recipe_id, 'recipe'::text, ri.ingredient_id
    from public.recipe_ingredients ri
    join public.ingredients i on i.id = ri.ingredient_id
    where i.component_kind = 'dish'
union
    select sc.recipe_suggestion_id, 'suggestion'::text, sc.ingredient_id
    from public.recipe_suggestion_components sc
union
    select si.recipe_suggestion_id, 'suggestion'::text, si.ingredient_id
    from public.recipe_suggestion_ingredients si
    join public.ingredients i on i.id = si.ingredient_id
    where i.component_kind = 'dish';

comment on view public.dish_components is
    'Explicit component declarations UNION the ingredient rows that are themselves component dishes. One read path; two write paths.';
