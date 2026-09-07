-- The week, as an annotation on the rows that already exist.
--
-- A plan is an ordered set of dishes a profile means to cook, and the shop for
-- it is the merge of their ingredients. Both of those already exist:
-- `shopping_lists` is one row per (profile, recipe), and the client merges any
-- number of them into one set of lines keyed on ingredient id, grouped by
-- aisle, scaled by servings and ticked across dishes. So a plan needs no rows
-- of its own — it is, from the database's point of view, a GROUP BY with an
-- ORDER BY. These three columns are that, exactly as `20260819000001` did it
-- for meals.
--
-- ## A plan is deliberately NOT a menu
--
-- The obvious move is to reuse the grouping above and call a week a meal. It
-- cannot be one. `menus` is a SHARED corpus — `20260821000001` put a
-- `unique (main_recipe_id, dish_signature)` on it precisely so every profile
-- who composes the same dishes lands on one row — so two people who both plan
-- the same five dinners would silently be handed each other's plan, and
-- `recent_community_menus` would then offer that plan to strangers on the home
-- feed as somebody's composed dinner. A menu is a claim about what goes
-- together; a week is a claim about nothing except one person's intent.
--
-- The two annotations are therefore independent, and a row may carry both: a
-- meal shopped for on Sunday can be a slot in the week. Which one wins as a
-- CARD is a client decision, recorded in `group-shopping-lists.ts`.

alter table shopping_lists
    -- The plan these rows belong to. Minted by the client, not a foreign key,
    -- and there is no `plans` table to point at — the same argument
    -- `menu_main_recipe_id` makes one column over: the group has to outlive
    -- whatever names it, and you may be standing in a shop holding the list it
    -- wrote. A uuid rather than a name because the title is editable in
    -- principle and a key must not be.
    --
    -- NOT unique with anything. One recipe still gets at most one
    -- `shopping_lists` row — the ticks are keyed by recipe id, so a second row
    -- for the same dish would tick and untick itself — which means planning a
    -- dish already on a list UPDATES that row rather than inserting beside it.
    add column if not exists plan_id    uuid,
    -- The dish's position in the week: 1, 2, 3. An ordinal, NOT a date, and
    -- that is the whole design.
    --
    -- Cook Thursday's dish on Tuesday and a dated plan is wrong in two places
    -- at once and has to be repaired before it is trustworthy again; an ordered
    -- set does not notice, because it never claimed a day. Deviation costs
    -- nothing by construction rather than by anybody remembering to make it
    -- cheap. It also means the plan needs no timezone, no rollover job and no
    -- answer to what happens to last week.
    --
    -- Not unique per plan either: two dishes sharing a slot is a legitimate
    -- thing to end up with mid-edit, and a constraint here would make writing
    -- an edit an ordering puzzle rather than a delete and an insert.
    add column if not exists plan_slot  smallint,
    -- Snapshot, on the same argument as `menu_title`: the card has to have a
    -- name after everything else is gone, and these rows are written in one
    -- statement and never edited alone, so they cannot disagree. Readers should
    -- take the title from any row of the plan.
    add column if not exists plan_title text;

-- Profile-first for the same reason as `idx_shopping_lists_profile_menu`: every
-- read is "my rows, grouped", and RLS puts the profile predicate on the query
-- whether the caller wrote one or not. `plan_slot` trails so the group comes
-- back in the order it is drawn in without a sort.
create index if not exists idx_shopping_lists_profile_plan
    on shopping_lists using btree (profile_id, plan_id, plan_slot);

comment on column shopping_lists.plan_id is
    'The plan (a week of dishes) these rows belong to. Client-minted; not a foreign key, and there is no `plans` table — the group outlives whatever named it. Deliberately not `menus`: that corpus is shared across profiles, so two people planning the same dinners would share one plan. NULL for a row that is not planned.';

comment on column shopping_lists.plan_slot is
    'The dish''s position in the plan, 1-based. An ordinal, not a date: cooking out of order must cost nothing, and an ordered set has nothing to be wrong about. NULL when `plan_id` is.';

comment on column shopping_lists.plan_title is
    'Plan name as it read when the plan was written. Snapshot, so the card survives the dishes changing under it.';
