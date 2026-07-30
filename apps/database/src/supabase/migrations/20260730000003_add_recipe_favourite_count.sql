-- Denormalized "likes" counter on recipes, sourced from favourite interactions.
--
-- Cards want the number of people who favourited a recipe. Counting
-- `profile_recipe_interactions` from the client is not an option: its RLS policy
-- only exposes the caller's own rows, so `count(*)` there always returns 0 or 1.
-- A counter column keeps the number on the recipe row itself, so every existing
-- select (find_recipes, the FTS search, the favourites/collection fetches) picks
-- it up without an extra round trip.
alter table recipes
    add column if not exists favourite_count INTEGER not null default 0;

-- Popularity ordering (e.g. "most liked") without a sort of the whole table.
create index if not exists idx_recipes_favourite_count on recipes (favourite_count desc);

-- Backfill from the interactions already recorded.
update recipes r
set favourite_count = f.count
from (select recipe_id, count(*) as count
      from profile_recipe_interactions
      where interaction_type = 'favourite'
      group by recipe_id) f
where r.id = f.recipe_id;

-- SECURITY DEFINER so the counter can be maintained on behalf of a user whose
-- RLS grants no write access to `recipes`.
create
or replace function public.sync_recipe_favourite_count () returns TRIGGER language PLPGSQL security definer
set
  search_path = public as $$
begin
  if
(TG_OP = 'DELETE' or TG_OP = 'UPDATE') and old.interaction_type = 'favourite' then
    update recipes
    set favourite_count = greatest(favourite_count - 1, 0)
    where id = old.recipe_id;
end if;

  if
(TG_OP = 'INSERT' or TG_OP = 'UPDATE') and new.interaction_type = 'favourite' then
    update recipes
    set favourite_count = favourite_count + 1
    where id = new.recipe_id;
end if;

  if
TG_OP = 'DELETE' then
    return old;
end if;

return new;
end;
$$;

drop trigger if exists trg_sync_recipe_favourite_count on profile_recipe_interactions;

create trigger trg_sync_recipe_favourite_count
    after insert or update or delete
    on profile_recipe_interactions
    for each row
execute function public.sync_recipe_favourite_count ();
