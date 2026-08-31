-- How many dishes actually use an ingredient, so the picker can lead with the
-- one that goes somewhere.
--
-- ## The failure this fixes
--
-- Both ingredient searches — `useSearchIngredients` (the fridge picker) and
-- `useFtsSearchIngredients` (the search screen's entity strip) — `order("name")`.
-- The catalogue holds twelve tomato rows, so typing "tomato" offers, in this
-- order: Canned Tomatoes, Cherry Tomatoes, Diced Tomato, Fresh Tomatoes,
-- Grilled Tomatoes, Heirloom Tomato, Ripe Tomato, Sun Dried Tomato, and only
-- then Tomato. Measured on the live catalogue 2026-08-30, the first eight are
-- used by NOTHING — no recipe and no suggestion — while `Tomato` carries 9
-- recipes and 46 suggestions.
--
-- `find_recipes` ANDs its ingredient filter over exact ids, so picking any of
-- those eight empties the result outright: Gazpacho, which lists plain Tomato,
-- is unreachable from a search for tomatoes. The reader gets an empty feed and
-- concludes the catalogue has no tomato dishes.
--
-- It is not a tomato problem. Of 1041 ingredients, only ~345 are referenced by
-- any recipe or suggestion, so two thirds of the picker is a trapdoor.
--
-- ## Why a column and not a count on read
--
-- Same reason `recipes.favourite_count` is one (20260801000003): the picker
-- searches as you type, and this is the sort key. PostgREST can order by a
-- column and cannot cheaply order by an aggregate over a join, so a view would
-- push the work into every keystroke.
--
-- ## What it counts, and what that costs
--
-- Recipes AND suggestions, in one number. The search screen shows both halves
-- and `find_recipes` returns both, so "will picking this return anything" is a
-- question about the union. Both junction tables carry a unique (dish,
-- ingredient) constraint, so a row count IS a dish count.
--
-- VARIANTS ARE COUNTED, deliberately, and this is the one known inaccuracy. A
-- variant recipe (`base_recipe_id is not null`) is filtered out of every
-- discovery surface, so its ingredients inflate a count for dishes nobody can
-- find. Excluding them would mean joining `recipes` from this trigger AND a
-- second trigger on `recipes` itself, because `persist_variant_base` can make
-- an existing recipe a variant after the fact. For a ranking signal that is not
-- worth two more moving parts: a variant's ingredients are mostly its base's,
-- so it inflates rows that already rank high. It would matter if this number
-- were ever shown to a user or used as a filter. It is neither.
--
-- ## Not a popularity signal
--
-- This counts CATALOGUE usage, not what people cook. `favourite_count` is the
-- reader-facing number and is unaffected. Do not present this one.

alter table ingredients
    add column if not exists use_count integer not null default 0;

comment on column ingredients.use_count is
    'Recipes plus suggestions referencing this ingredient. Maintained by trigger; a catalogue-coverage signal for ordering the pickers, never shown to a reader.';

-- Serves the staples query, which orders by this with no filter in front of it
-- (`usePopularIngredients`, LIMIT 30). The two search hooks filter on
-- `name_ascii` first and sort a handful of rows, so they do not need it.
create index if not exists idx_ingredients_use_count
    on ingredients using btree (use_count desc, name);

-- Keeps ingredients.use_count in step with both junction tables.
--
-- One function for two tables: the row shape differs but the only column this
-- reads is `ingredient_id`, which both carry under that name.
--
-- The UPDATE arm is what keeps `merge_ingredient` honest — it repoints
-- `ingredient_id` on both tables and then deletes the leftovers, so without it
-- a merge would strand the whole count on the row that just went away.
create or replace function public.sync_ingredient_use_count()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
as $function$
begin
    if TG_OP = 'DELETE'
        or (TG_OP = 'UPDATE' and new.ingredient_id is distinct from old.ingredient_id) then
        update ingredients
        set use_count = greatest(use_count - 1, 0)
        where id = old.ingredient_id;
    end if;

    if TG_OP = 'INSERT'
        or (TG_OP = 'UPDATE' and new.ingredient_id is distinct from old.ingredient_id) then
        update ingredients
        set use_count = use_count + 1
        where id = new.ingredient_id;
    end if;

    if TG_OP = 'DELETE' then
        return old;
    end if;

    return new;
end;
$function$;

-- `update of ingredient_id` rather than a bare `update`: the only other write
-- to these tables is `merge_ingredient` summing quantities, which touches
-- `quantity` and `comment` and must not walk the counter.
drop trigger if exists trg_sync_ingredient_use_count_recipes on recipe_ingredients;
create trigger trg_sync_ingredient_use_count_recipes
    after insert or delete or update of ingredient_id
    on recipe_ingredients
    for each row
execute function sync_ingredient_use_count();

drop trigger if exists trg_sync_ingredient_use_count_suggestions on recipe_suggestion_ingredients;
create trigger trg_sync_ingredient_use_count_suggestions
    after insert or delete or update of ingredient_id
    on recipe_suggestion_ingredients
    for each row
execute function sync_ingredient_use_count();

-- Backfill. Written as one pass over `ingredients` rather than two aggregates
-- joined back, so a row referenced by neither table is set to 0 rather than
-- left at the default by accident.
update ingredients i
set use_count = (select count(*)
                 from recipe_ingredients ri
                 where ri.ingredient_id = i.id)
    + (select count(*)
       from recipe_suggestion_ingredients rsi
       where rsi.ingredient_id = i.id);

notify pgrst, 'reload schema';
