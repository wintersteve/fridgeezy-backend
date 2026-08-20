-- Shopping lists that came from a menu, grouped as one card.
--
-- A list built from a composed meal is four `shopping_lists` rows with nothing
-- saying they belong together, so the lists screen drew four unrelated cards
-- for what the user thinks of as one shop. These two columns are that label.
--
-- Note what is NOT here: no `shopping_list_groups` table, and no reuse of menus
-- between profiles. The grouping is an annotation on rows that already exist —
-- zero new rows for a feature that is, from the database's point of view, a
-- GROUP BY. Sharing menus across users cannot pay either: a menu is an ordered
-- tuple of ids over a recipe catalogue that the dedup pipeline ALREADY shares
-- globally, so the only thing a shared menu table would deduplicate is the
-- handful of profiles who composed the byte-identical set of dishes. One
-- recipe's 1536-dimension embedding (6 KB) outweighs three whole saved menus.

alter table shopping_lists
    -- The meal these rows were shopped for, identified BY ITS MAIN RECIPE —
    -- which is how this product already identifies a meal: `menus` is unique on
    -- `(profile_id, main_recipe_id)`, and the compose screen finds the saved
    -- copy of what it is showing with exactly this lookup.
    --
    -- Not `menu_id`, though that is the obvious name, because a meal does not
    -- need to be SAVED to be shopped for: the basket button on the compose
    -- screen works with the heart untoggled, and there is no `menus` row to
    -- point at in that case. Keying on the main also survives the meal being
    -- deleted and saved again, which mints a new `menus.id` for what the user
    -- experiences as the same meal.
    --
    -- Deliberately not a foreign key either, on the same argument as
    -- `menu_courses.recipe_id`: the group has to outlive whatever it names.
    -- Un-saving a meal is one tap on a heart, and you may be standing in a shop
    -- holding the list it wrote — `on delete cascade` would empty that basket
    -- and `on delete set null` would dissolve the card mid-aisle.
    add column if not exists menu_main_recipe_id uuid,
    -- Snapshot, on the same argument as `menu_courses`' name/description/image:
    -- the card still has to have a title after the meal is gone.
    --
    -- Denormalised across the group's rows on purpose. They are written in one
    -- statement and never edited alone, so they cannot disagree, and the
    -- alternative is the group table this migration exists to avoid. Readers
    -- should take the title from any row of the group.
    add column if not exists menu_title          text;

-- Composite and profile-first: every read of this is "my rows, grouped", and
-- RLS puts the profile predicate on the query whether the caller wrote one or
-- not. A bare index on the meal alone would be scanned and then filtered.
create index if not exists idx_shopping_lists_profile_menu
    on shopping_lists using btree (profile_id, menu_main_recipe_id);

comment on column shopping_lists.menu_main_recipe_id is
    'The composed meal these rows were added from, identified by its main recipe (as `menus.main_recipe_id` does). Not a foreign key — the group outlives the meal, and the meal need not be saved. NULL for a recipe added on its own.';

comment on column shopping_lists.menu_title is
    'Menu name as it read when the list was built. Snapshot, so the group card survives the meal being deleted.';
