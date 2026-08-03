-- Per-ingredient dietary properties: the raw facts a dietary claim is derived from.
--
-- WHY NOT KEEP TAGGING RECIPES
-- Today a recipe is "vegan" because the model said so while writing it. That is
-- the one place being wrong actually hurts, and it is also where the model is
-- weakest: of the recipes in the catalogue only three carry any dietary tag at
-- all. Worse, the cost of that approach grows without limit — every generated
-- recipe is a fresh set of judgements nobody checks.
--
-- Ingredients are a bounded, slowly-growing set (505 rows at the time of
-- writing) and each one is a single objective question with a stable answer.
-- Classifying them once is strictly less work than tagging every recipe, every
-- answer is auditable, and correcting one row fixes every recipe that uses it.
--
-- PROPERTIES, NOT DIETS
-- The columns record what an ingredient IS ("contains dairy"), never which diet
-- it suits ("is vegan"). Properties are objective and stable; diets are policy
-- and change. Adding a diet later is then a row in `dietary_rules`
-- (see the next migration), not a re-classification of 505 ingredients.

-- Deliberately excludes anything a diet needs but an ingredient list cannot
-- show. There is no `halal`/`kosher` property: both depend on slaughter method
-- and certification, which no amount of ingredient data reveals — claiming them
-- from a component list would be a guess wearing a badge. Those two stay
-- model-tagged (see the fallback in find_recipes).
create type dietary_property as enum (
    -- Flesh
    'meat', -- mammal or bird
    'fish',
    'shellfish',
    -- Animal, not flesh
    'dairy',
    'egg',
    'honey', -- separated from `slaughter_derived` on purpose: vegans exclude
             -- honey, vegetarians do not, so they cannot share a property
    'slaughter_derived', -- gelatin, rennet, lard, tallow, carmine, isinglass
    -- Allergens / intolerances
    'gluten',
    'nuts', -- tree nuts AND peanuts; the two are one filter to a user
    'soy',
    -- Paleo exclusions
    'grain',
    'legume',
    'refined_sugar'
    );

alter table ingredients
    add column if not exists dietary_properties dietary_property[] not null default '{}',
    -- NULL is the whole point: it distinguishes "known to have no relevant
    -- properties" (classified, empty array — water, salt) from "nobody has
    -- looked at this yet". Without it an unclassified ingredient reads as safe
    -- for every diet, which is the exact failure mode this migration exists to
    -- prevent.
    add column if not exists dietary_classified_at timestamptz;

comment on column ingredients.dietary_properties is
    'Objective dietary facts about the ingredient. Empty means none apply, and is only meaningful once dietary_classified_at is set.';
comment on column ingredients.dietary_classified_at is
    'When the properties were last determined. NULL means unclassified: any recipe using this ingredient has UNKNOWN dietary status, never a safe one.';

-- Supports the `&&` (overlaps) test that the derivation runs per ingredient.
create index if not exists idx_ingredients_dietary_properties
    on ingredients using gin (dietary_properties);

-- Finding what still needs classifying is a routine query for the backfill
-- operation, and it is always the same one.
create index if not exists idx_ingredients_dietary_unclassified
    on ingredients (id) where dietary_classified_at is null;
