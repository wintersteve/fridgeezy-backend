------------------------------------------------------------------------------
-- Which meal a planned dish is, said rather than inferred
------------------------------------------------------------------------------
--
-- The planner derived this from a dish's POSITION in its day — first is
-- breakfast, second lunch, third dinner. That is exactly right for a day
-- holding all three and wrong for every other one, which is most of them: plan
-- one dinner for Friday and the app called it your breakfast.
--
-- Every purely positional scheme has the same shape of failure, and filling
-- backwards from dinner only moves it: one dish becomes dinner correctly, and
-- then adding a breakfast silently DEMOTES it to lunch. The reader touched one
-- row and a different row changed meaning.
--
-- ## It also unblocks the gesture
--
-- Dragging a row up a derived list does not move a dish to a meal, it renames
-- every dish it passes. With the meal stored, a day is not a list — it is three
-- or four named bands, and a drag writes ONE field on ONE row. Nothing else on
-- the day moves, which is the difference between a gesture that can ship and
-- one that cannot.
--
-- ## Nullable, and null means dinner
--
-- Null keeps the meaning it has everywhere else in this schema — NOT RECORDED —
-- so nothing has to be backfilled and a row written by an older client is not a
-- lie. It READS as dinner, which is both the safest single guess and what every
-- existing planned row was overwhelmingly likely to have meant.
--
-- `plan_slot` is untouched and still earns its place: it orders dishes WITHIN a
-- meal, for the day that has two snacks on it.

alter table shopping_lists
    add column if not exists plan_meal text;

alter table shopping_lists
    drop constraint if exists shopping_lists_plan_meal_check;

-- Text + check rather than an enum, following `recipes.origin` and
-- `profile_taste_signals.kind`: widening a check is one migration, widening an
-- enum is `alter type` and cannot be done inside a transaction with other DDL
-- on some versions.
alter table shopping_lists
    add constraint shopping_lists_plan_meal_check
        check (plan_meal is null
            or plan_meal in ('breakfast', 'lunch', 'dinner', 'snack'));

comment on column shopping_lists.plan_meal is
    'Which meal this planned dish is: breakfast, lunch, dinner or snack. STORED rather than derived from position — a day holding one dish has a dinner, not a breakfast, and a stored meal is what stops adding a dish renaming the ones already there. NULL means not recorded and reads as dinner. `plan_slot` still orders dishes within a meal.';

-- Profile-first like its neighbours: every read is "my rows, this plan", and
-- the meal is what the day is then bucketed by.
create index if not exists idx_shopping_lists_profile_plan_meal
    on shopping_lists using btree (profile_id, plan_id, plan_meal);
