-- Which ingredient lines are dishes in disguise.
--
-- WHY THIS EXISTS
-- `COMPONENT_RULE` already tells every generator that Béchamel is a `sauce` and
-- Lasagne is a finished dish "even though it contains both". The catalogue
-- therefore holds components AS RECIPES (Beurre Blanc, Toum, Mala Oil,
-- Arrabbiata Sauce) and components AS INGREDIENTS (Bechamel Sauce, Pizza Dough,
-- Tomato Sauce, Strudel Dough, Red Curry Paste) — and NOTHING joins the two
-- halves. Measured 2026-08-23: across all 498 `recipe_ingredients` rows, not one
-- ingredient's `canonical_id` equals a recipe's.
--
-- The link cannot be recovered from the data already stored. Names do not match,
-- because ingredient rows are written by the ingredient extractor and recipe
-- names by the dish generator. Substring matching is worse than nothing — it
-- produces "Chili" -> Chili con Carne and "Kimchi" -> Kimchi Stew. And no other
-- column separates the two: `Bechamel Sauce` and `Soy Sauce` sit in the same
-- `Sauces` category, both with a null `parent_id`.
--
-- So it has to be decided, once, per ingredient. That is what these columns hold.
--
-- WHY THE INGREDIENT AND NOT THE RECIPE
-- The same argument 20260803000003 makes for dietary properties, and for the
-- same reasons: ingredients are a bounded, slowly-growing set (1,067 rows here),
-- each is a single objective question with a stable answer, correcting one row
-- fixes every recipe that uses it, and the cost is paid once instead of per
-- generated dish. Deciding it per recipe would additionally let ONE ingredient
-- come back makeable in one dish and bought in another.
--
-- THE THREE-WAY ANSWER, AND WHY IT IS NOT A BOOLEAN
-- Sorting the real rows produces three groups, not two, and they want different
-- treatment on screen:
--
--   'dish'   Pizza Dough, Bechamel Sauce, Tomato Sauce, Rouille, Red Curry Paste
--            — you make it, and it has a name a cook would recognise. This is the
--            only value that resolves to a recipe.
--   'prep'   Cooked Rice, Clarified Butter, Boiled Beets, Pickled Cucumber
--            — you make it, it is not a dish, and nobody wants a recipe card for
--            it. Recorded rather than dropped so the classifier has somewhere
--            honest to put them; the client draws nothing for these today.
--   'bought' Soy Sauce, Fish Sauce, Worcestershire, Oyster Sauce, Miso Paste,
--            Stock Cubes — named like a component, made in a factory.
--
-- 'bought' is the one that has to be right. Missing a béchamel costs a link
-- nobody notices; offering to make SOY SAUCE (in 7 of 50 recipes) is visibly
-- absurd and teaches the reader to ignore the marker everywhere else. Same
-- asymmetry `COMPONENT_RULE` reasons about, so the prompt leans the same way.
--
-- NULL IS UNCLASSIFIED, AND NEEDS NO TIMESTAMP
-- Note the difference from `dietary_properties`, which is `not null default '{}'`
-- and so had to carry `dietary_classified_at` to tell "checked, carries nothing"
-- apart from "nobody has looked". Here that distinction is already in the
-- vocabulary: 'bought' IS the checked-and-nothing-to-offer answer, so a null
-- column means unclassified and nothing else. An unclassified ingredient draws
-- no marker, which is the same thing the safe answer draws.
create type component_kind as enum ('dish', 'prep', 'bought');

alter table ingredients
    add column if not exists component_kind component_kind,
    -- The dish name to RESOLVE, which is not the ingredient's display name.
    -- "Bechamel Sauce" the ingredient opens "Béchamel" the dish; "Rouille Sauce"
    -- opens "Rouille". `/suggestions/resolve` takes a name and checks the
    -- catalogue before it writes anything, so the closer this is to what the
    -- dish is actually called, the more often it hits a recipe that exists
    -- instead of generating a near-duplicate.
    add column if not exists component_dish text;

-- The reverse edge, for free.
--
-- Once an ingredient names its dish, "what uses this béchamel" is an equality
-- join rather than a paid generation — which is what the compose flow's
-- `component_dishes` mode currently pays for on every single ask and stores
-- nothing from. Generated from `component_dish` for exactly the reason
-- `recipes.canonical_id` is generated from `recipes.name`: derived by the
-- database, it cannot drift from the value it is derived from.
alter table ingredients
    add column if not exists component_dish_canonical_id text
        generated always as (normalize_to_canonical_id(component_dish)) stored;

-- A dish is the only kind that has a dish, and it must have one. Without this a
-- 'dish' row with a null name is a marker on screen that opens nothing.
alter table ingredients
    drop constraint if exists ingredients_component_dish_check;

alter table ingredients
    add constraint ingredients_component_dish_check check (
        (component_kind = 'dish' and component_dish is not null)
            or (component_kind is distinct from 'dish' and component_dish is null)
        );

create index if not exists idx_ingredients_component_kind
    on ingredients using btree (component_kind)
    where (component_kind is not null);

create index if not exists idx_ingredients_component_dish_canonical_id
    on ingredients using btree (component_dish_canonical_id)
    where (component_dish_canonical_id is not null);

comment on column ingredients.component_kind is
    'Whether this ingredient is a dish you make (dish), preparation that is not a dish (prep), or a product you buy (bought). NULL means nobody has classified it, which the client draws exactly as it draws bought.';
comment on column ingredients.component_dish is
    'For component_kind = dish only: the dish name to resolve, which is not always the ingredient name — "Bechamel Sauce" opens "Bechamel".';
comment on column ingredients.component_dish_canonical_id is
    'Generated from component_dish. Joins to recipes.canonical_id, which is what makes "dishes that use this component" a query rather than a generation.';
