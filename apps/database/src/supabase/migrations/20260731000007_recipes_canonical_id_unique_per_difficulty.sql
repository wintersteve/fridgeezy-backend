-- 20260731000006 constrained non-variant recipes to ONE row per canonical_id,
-- which contradicts the model the rest of the app is built on: easy/medium/hard
-- are genuinely different recipes for the same dish, all non-variant, all sharing
-- a name. `findBaseRecipe` has always keyed its reuse lookup on (name,
-- difficulty), and persist-recipe says so explicitly.
--
-- The practical effect was that difficulty escalation stopped working the moment
-- 000006 landed: escalating an existing recipe persists a second base row under
-- the same name at the target difficulty, which the index rejected with
--   duplicate key value violates unique constraint "recipes_canonical_id_unique"
-- so no recipe could ever be escalated a second time.
--
-- Difficulty joins the key. That still gives 000006 what it was written for — a
-- second promotion of the SAME dish at the SAME difficulty (the concurrent-
-- promotion race in 20260729000002) still raises a unique_violation, which the
-- promote flow catches and turns into a reuse — while leaving the three
-- difficulties of a dish free to coexist.
--
-- Variants (base_recipe_id set) stay unconstrained: they deliberately share
-- their base's name AND its difficulty.
drop index if exists recipes_canonical_id_unique;

create unique index recipes_canonical_id_difficulty_unique
    on recipes (canonical_id, difficulty)
    where base_recipe_id is null;

comment on index recipes_canonical_id_difficulty_unique is
'One non-variant recipe per (dish, difficulty). Difficulty is part of the key because easy/medium/hard are separate recipes for the same dish — see findBaseRecipe, which reuses on exactly this pair.';
