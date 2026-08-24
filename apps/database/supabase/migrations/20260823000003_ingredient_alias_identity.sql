-- Alias identity: give `ingredient_aliases` the same canonical rule
-- `ingredients` already has, so an alias lookup cannot miss on capitalisation.
--
-- The defect this closes: `findByAliases` matched `alias` literally, with
-- Title-Case model output ("Green Onion") against lowercase stored aliases
-- ("green onion"). 236 of 238 aliases are stored lowercase, so the alias layer
-- of `matchIngredients` missed on essentially every name the generator emits —
-- while the table held the right answer. `green onion -> Scallion` has existed
-- the whole time, and a separate `Green Onion` ingredient row was created
-- anyway. Same for `spring onion`, `all-purpose flour`, `active dry yeast`,
-- `beetroot` and 45 others.
--
-- `alias` keeps its own unique constraint. That one is case-SENSITIVE, so it
-- permits "Green Onion" and "green onion" as two rows; the canonical index
-- below is what actually collapses them.

alter table ingredient_aliases
    add column if not exists alias_canonical_id text;

-- Mirrors `set_ingredient_canonical_id()` on the ingredients table, deliberately:
-- the identity rule for an alias must be the identity rule for a name, or the
-- lookup this exists to fix would miss again for a subtler reason.
create or replace function public.set_alias_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.alias_canonical_id := ingredient_canonical_id(new.alias);
    return new;
end;
$function$;

create trigger set_alias_canonical_id_trigger
    before insert or update
    on ingredient_aliases
    for each row
execute function set_alias_canonical_id();

update ingredient_aliases
set alias_canonical_id = ingredient_canonical_id(alias)
where alias_canonical_id is null;

-- A SELF-alias — one whose canonical form is its own target's canonical_id, e.g.
-- "chicken eggs" -> Chicken Egg (canonical `chicken_egg`) — is inert by
-- construction: `resolve` matches `ingredients.canonical_id` BEFORE it ever
-- reads this table, so the row can never be the thing that decides a lookup.
--
-- They are dropped here because they are also the entire source of canonical
-- collision. Four canonical groups currently hold two aliases pointing at
-- DIFFERENT ingredients, and in every one the pair is a self-alias against a
-- real synonym mapping:
--
--   chicken_egg      "chicken eggs"      -> Chicken Egg (self)  vs "chicken egg"      -> Egg
--   coriander_seed   "coriander seeds"   -> Coriander Seed (self) vs "coriander seed" -> Coriander
--   green_pea        "green peas"        -> Green Peas (self)   vs "green pea"        -> Peas
--   panko_breadcrumb "panko breadcrumbs" -> Panko Breadcrumbs (self) vs "panko breadcrumb" -> Panko
--
-- Dropping the inert side resolves all four without choosing between two real
-- mappings — which is what an arbitrary "keep the oldest" tie-break would have
-- done, and it would have picked wrong in three of the four.
-- Verified against the live catalogue: 44 rows, and 0 canonical collisions left.
delete
from ingredient_aliases a using ingredients i
where i.id = a.ingredient_id
  and a.alias_canonical_id = i.canonical_id;

-- Whatever still collides now differs only by CASE or PUNCTUATION and points at
-- the same ingredient — "Green Onion" beside "green onion". Those are the rows
-- the old case-sensitive `alias` unique constraint was powerless to stop, and
-- collapsing them is the whole point of keying on the canonical form.
--
-- Refuse rather than guess if any surviving group disagrees about its TARGET.
-- On the live catalogue there are none (verified: the 44 self-aliases above
-- account for every such conflict), but "keep the oldest" applied to two real,
-- differing mappings would silently pick one — and picking wrong here writes a
-- bad merge into the table every later lookup trusts.
do $$
declare
    conflicted text;
begin
    select string_agg(alias_canonical_id, ', ')
    into conflicted
    from (select alias_canonical_id
          from ingredient_aliases
          group by alias_canonical_id
          having count(distinct ingredient_id) > 1) as g;

    if conflicted is not null then
        raise exception
            'ingredient_aliases: canonical ids map to more than one ingredient (%). Resolve by hand before migrating.',
            conflicted;
    end if;
end;
$$;

delete
from ingredient_aliases a
where a.ctid <> (select min(b.ctid)
                 from ingredient_aliases b
                 where b.alias_canonical_id = a.alias_canonical_id);

alter table ingredient_aliases
    alter column alias_canonical_id set not null;

-- The index the fixed lookup reads, and the constraint that stops the
-- case-variant pair ever existing again.
create unique index if not exists ingredient_aliases_canonical_key
    on ingredient_aliases using btree (alias_canonical_id);

-- Deliberately NOT added: a constraint forbidding an ingredient whose
-- canonical_id is claimed by an alias. 50 such rows exist today, and the check
-- would make `persist_recipe` raise mid-stream on a live recipe — turning a
-- cosmetic catalogue problem into a user-visible failure. Those rows are found
-- by the `ingredient_alias_collisions` view below and merged out of band.
create or replace view ingredient_alias_collisions as
select i.id           as duplicate_id,
       i.name         as duplicate_name,
       t.id           as keep_id,
       t.name         as keep_name,
       a.alias        as via_alias,
       (select count(*) from recipe_ingredients r where r.ingredient_id = i.id)
           + (select count(*) from recipe_suggestion_ingredients s where s.ingredient_id = i.id)
                      as duplicate_uses
from ingredients i
         join ingredient_aliases a on a.alias_canonical_id = i.canonical_id
         join ingredients t on t.id = a.ingredient_id and t.id <> i.id;

comment on view ingredient_alias_collisions is
    'Ingredient rows whose canonical id is already claimed by an alias pointing '
        'elsewhere — duplicates by construction, no embedding or LLM involved. '
        'Should trend to zero once the backfill merge runs; a non-empty result '
        'afterwards means a write path is still bypassing alias resolution.';
