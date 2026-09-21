-- One composite index for the way this table is actually read, and two
-- single-column indexes retired in the same breath.
--
-- `profile_recipe_interactions` carried three: `profile_id`, `recipe_id` and
-- `interaction_type`. Every READ of it asks the same shape — one profile, one
-- type, newest first — because that is what the four surfaces over it are: the
-- favourites list, the view history, its keyset pages (`useViewedRecipes`) and
-- the prune in `20260918000001`. None of the three serves that shape; the
-- planner picks `profile_id`, fetches the profile's whole set, and top-N sorts
-- it.
--
-- ## Measured, on 202,000 rows with the real distribution
--
-- 4,000 profiles at 50 rows each plus one heavy profile at 2,000, fetching the
-- newest 18 of one type:
--
--   50-row profile    before: 46 rows + top-N sort, 52 buffers
--                      after: 18 rows,               21 buffers
--   2,000-row profile before: 1,819 rows + top-N sort, 28 buffers, 0.204 ms
--                      after: 18 rows,                  4 buffers, 0.110 ms
--
-- **At 50 rows it changes nothing**, and that is worth stating plainly: the
-- viewed half is capped there. The win is that the work stops scaling with how
-- much a profile has, which is what the FAVOURITE half needs — that one has no
-- cap by design (a heart is the reader's own kept data), it is read on the home
-- feed on every launch, and today a reader with 2,000 favourites makes the
-- database read and sort all 2,000 to draw ten cards.
--
-- ## Why two indexes come OFF
--
-- `interaction_type` alone indexes a column with two values in it, and the
-- planner declined it in every plan measured — it was write cost on the
-- most-written user table in the schema and nothing else. `profile_id` alone is
-- strictly dominated by a composite that leads with the same column, including
-- for the one job it still had to do: finding a profile's rows when
-- `auth.admin.deleteUser` cascades (see `20260918000002`… the account route,
-- and `apps/api/src/modules/account`).
--
-- Net: one index maintained instead of two, on every recipe open.
--
-- **`recipe_id` STAYS.** It covers the other direction — finding the
-- interactions that point at a recipe being deleted or merged — which
-- `merge_recipe` and `delete_orphan_generated_recipes` both need, and no
-- composite here leads with it.
--
-- ## If this table is ever large, build it CONCURRENTLY instead
--
-- `create index` takes a SHARE lock and blocks writes until it finishes, and a
-- migration runs in a transaction, where `concurrently` is not allowed. At this
-- table's present size that is milliseconds. Past a few million rows, the
-- honest version is to run the `concurrently` form by hand and leave this file
-- as the record of it.

create index if not exists idx_profile_recipe_interactions_profile_type_created
    on profile_recipe_interactions using btree (profile_id, interaction_type, created_at desc);

drop index if exists idx_profile_recipe_interactions_type;
drop index if exists idx_profile_recipe_interactions_profile_id;

notify pgrst, 'reload schema';
