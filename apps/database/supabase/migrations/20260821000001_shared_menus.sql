-- A menu belongs to nobody. Saving one is a reference.
--
-- `menus` has been per-profile since `20260806000001`, and every community
-- surface built on top of it since — the home feed's strip, the recipe screen's
-- badge, the menus sheet — had to be a SECURITY DEFINER aggregate reaching past
-- RLS, plus `menu_is_publishable` to keep those three honest. That is a lot of
-- machinery to work around a storage model, and the model is what was wrong:
-- the product SHOWS other people's menus, so a menu is community content and
-- storing it as somebody's private row was always going to need a bypass.
--
-- ## Identity
--
-- A menu IS its dishes. Two people who composed the same set around the same
-- main composed the same menu, whatever order the stream filled the slots in
-- and whatever the model happened to title it — which is exactly what
-- `community_menus_for_recipe` already asserts, at read time, with `array_agg`
-- and `mode() within group`. This makes it the key instead:
-- `unique (main_recipe_id, dish_signature)`.
--
-- BOTH halves. A menu around a steak with a salad beside it and a menu around
-- the salad with a steak beside it are different menus, and the difference is
-- load-bearing rather than pedantic: the main is what a tile navigates to, what
-- `saved_menus` is unique on, and what `shopping_lists.menu_main_recipe_id`
-- groups by. Key on the dish set alone and the second composer's saved meal
-- silently reports the first composer's main — their compose heart never
-- lights, and the "Go to meal" action on a shopping-list group stops finding
-- anything.
--
-- ## Ownership is STORED, and that is the whole reason this migration works
--
-- `owner_profile_id` mirrors `recipes.created_by` exactly: NULL is the shared
-- corpus, non-null means one profile. The obvious alternative — derive it, by
-- asking whether any course points at an owned recipe, which is what
-- `menu_is_publishable` does today — cannot be used in a policy here:
--
--   * IT RECURSES. A policy on `menus` that reads `menu_courses`, whose own
--     policy reads `menus`, is a cycle; Postgres raises `42P17 infinite
--     recursion detected in policy` and EVERY read of either table fails,
--     including the ones inside `save_menu`.
--   * IT FAILS OPEN. The derived test is `not exists (join recipes …
--     created_by is not null)`. Delete the imported recipe and the join finds
--     nothing, so the menu flips from private to public — with the private
--     dish's name still sitting in `menu_courses.name`, because that column is
--     a snapshot. Today `profile_id references profiles on delete cascade`
--     hides this; dropping `profile_id` is what would expose it.
--
-- A stored column fails closed and keeps both policies free of subqueries over
-- the other table.
--
-- ## What this does NOT change
--
-- `menu_courses` keeps its snapshot columns and its polymorphic `recipe_id`.
-- `shopping_lists.menu_main_recipe_id` keeps its meaning and needs no edit —
-- it is deliberately not a foreign key (`20260819000001`), so it survives all
-- of this. Note that migration's header argues sharing menus "cannot pay"; it
-- argues it on STORAGE grounds, and storage was never the reason.

------------------------------------------------------------------------------
-- 1. The columns
------------------------------------------------------------------------------

alter table menus
    -- NULL is the shared corpus; non-null means exactly one profile may read
    -- it. See the header for why this is stored rather than derived.
    add column if not exists owner_profile_id uuid references profiles (id) on delete cascade,

    -- The menu's identity, with main_recipe_id. Sorted, so it is
    -- order-independent; over `dish_key` rather than `recipe_id`, so a menu
    -- composed before a suggestion was promoted and one composed after are the
    -- same menu.
    add column if not exists dish_signature uuid[],

    -- Denormalised so the curation rule is two columns and the discovery reads
    -- carry no subquery at all. Written once, when the courses are.
    add column if not exists course_count integer not null default 0,

    -- What `count(distinct profile_id)` used to compute on every read. Same
    -- pattern as `recipes.favourite_count`, same trigger shape.
    add column if not exists saved_count integer not null default 0;

alter table menu_courses
    -- IMMUTABLE, and not the same thing as `recipe_id`. That column is the
    -- as-saved POINTER and may go stale the moment a suggestion is promoted;
    -- this is what the menu's identity is computed over, so no promotion can
    -- ever re-key a menu. Recipes normalise to the suggestion they came from
    -- (`recipes.source_suggestion_id`), so both compositions agree.
    add column if not exists dish_key uuid;

-- Wanted by the dish_key resolution, by the sweep clause added in
-- `20260821000003`, and by any future merge. `menu_courses` has only ever been
-- indexed by `menu_id`.
create index if not exists idx_menu_courses_recipe_id
    on menu_courses using btree (recipe_id);

------------------------------------------------------------------------------
-- 2. The reference table
------------------------------------------------------------------------------
--
-- What `recipe_variants` is to `recipes`: "this profile keeps that menu", with
-- a label of its own. The label is why this is not a bare join table — two
-- people who compose the same dishes now land on ONE row, and the title is
-- model-generated per composition, so without a per-profile copy the second
-- saver would watch their meal be renamed to a stranger's wording in their own
-- saved list at the moment they saved it.

create table if not exists saved_menus
(
    id             uuid primary key                  default gen_random_uuid(),
    profile_id     uuid                     not null references profiles (id) on delete cascade,
    menu_id        uuid                     not null references menus (id) on delete cascade,
    -- Denormalised off the menu by trg_saved_menus_before_write and never
    -- supplied by the caller, so it cannot drift. It exists for the unique
    -- below, which is the product rule "one saved meal per main dish" — the
    -- rule `menus_profile_id_main_recipe_id_key` used to carry, and which the
    -- compose screen's heart, the recipe screen's badge and the shopping-list
    -- group action all still key on.
    main_recipe_id uuid                     not null,
    -- The title THIS profile's compose produced. NULL falls back to the menu's.
    label          text,
    created_at     timestamp with time zone not null default now(),
    updated_at     timestamp with time zone not null default now(),
    constraint saved_menus_profile_id_main_recipe_id_key unique (profile_id, main_recipe_id),
    constraint saved_menus_label_check
        check (label is null or char_length(btrim(label)) between 1 and 120)
);

create index if not exists idx_saved_menus_profile_id on saved_menus using btree (profile_id);
create index if not exists idx_saved_menus_menu_id on saved_menus using btree (menu_id);

alter table saved_menus enable row level security;

comment on table saved_menus is
    'Per-profile reference into the shared `menus` table. The only menu table a client writes.';

------------------------------------------------------------------------------
-- 3. Triggers on the reference — created BEFORE the backfill uses it
------------------------------------------------------------------------------

create or replace function public.saved_menus_before_write()
    returns trigger
    language plpgsql
as
$function$
declare
    v_main uuid;
begin
    -- `users_manage_own_saved_menus` is FOR ALL, so a client that can insert
    -- can also update. `menu_id` is the one thing about a save that is an
    -- opinion — re-saving the same main with a different course set repoints
    -- it — so that stays mutable and the rest does not. Same argument as
    -- `recipe_variants_before_update` (20260815000004).
    if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
        raise exception using
            errcode = 'restrict_violation',
            message = 'saved_menus: profile_id is immutable',
            hint = 'Delete this row and insert a new one.';
    end if;

    select m.main_recipe_id into v_main from menus m where m.id = new.menu_id;

    if v_main is null then
        raise exception using
            errcode = 'foreign_key_violation',
            message = format('saved_menus: no readable menu %s', new.menu_id);
    end if;

    new.main_recipe_id := v_main;
    new.updated_at := now();
    return new;
end;
$function$;

drop trigger if exists trg_saved_menus_before_write on saved_menus;

create trigger trg_saved_menus_before_write
    before insert or update
    on saved_menus
    for each row
execute function public.saved_menus_before_write();

-- `sync_recipe_favourite_count` with the nouns changed, including its
-- `greatest(x - 1, 0)` floor.
--
-- INSERT OR DELETE OR **UPDATE**, and the UPDATE arm is not optional: the
-- upsert in `save_menu` repoints `menu_id` when someone re-saves the same main
-- with a different course set, and that is an UPDATE. Without the arm the old
-- menu's count never falls and the new one's never rises.
create or replace function public.sync_menu_saved_count()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_temp
as
$function$
begin
    if tg_op = 'DELETE' or tg_op = 'UPDATE' then
        -- On a cascade from `menus` this matches nothing, because the parent
        -- row is already gone. Harmless, and the same shape the
        -- recipes/profile_recipe_interactions pair has always had.
        update menus
        set saved_count = greatest(saved_count - 1, 0)
        where id = old.menu_id;
    end if;

    if tg_op = 'INSERT' or tg_op = 'UPDATE' then
        update menus
        set saved_count = saved_count + 1
        where id = new.menu_id;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$function$;

drop trigger if exists trg_sync_menu_saved_count on saved_menus;

create trigger trg_sync_menu_saved_count
    after insert or delete or update
    on saved_menus
    for each row
execute function public.sync_menu_saved_count();

------------------------------------------------------------------------------
-- 4. Backfill
------------------------------------------------------------------------------
--
-- Written as queries over the data rather than against ids, so this is a no-op
-- on a fresh database — which is what `db reset` replays it against — and
-- re-runnable on any other. Same shape as `20260801000016`.

-- A menu with no courses cannot have an identity, and there is nothing to show
-- for it. Deleted rather than left to fail the NOT NULL in section 5.
delete
from menus m
where not exists (select 1 from menu_courses mc where mc.menu_id = m.id);

-- The identity token. Deliberately resolved through `recipes` rather than
-- through `menu_courses.is_recipe`, which is client-written and can be stale:
-- a row that says "suggestion" but points at a recipe still normalises here.
update menu_courses mc
set dish_key = coalesce(
        (select coalesce(r.source_suggestion_id, r.id) from recipes r where r.id = mc.recipe_id),
        mc.recipe_id)
where mc.dish_key is null;

-- Ownership, from the courses and from the main. Both, because
-- `saved-meal-card` falls back to the first course when the main is not among
-- them, so "the main is always a course" is a habit rather than an invariant.
update menus m
set owner_profile_id = coalesce(
    -- Any owned course makes the whole menu owned. `limit 1` rather than an
    -- aggregate because uuid has no `max()`, and because there is at most one
    -- answer anyway: you can only compose with recipes you can read.
        (select r.created_by
         from menu_courses mc
                  join recipes r on r.id = mc.recipe_id
         where mc.menu_id = m.id
           and r.created_by is not null
         limit 1),
        (select r.created_by from recipes r where r.id = m.main_recipe_id))
where m.owner_profile_id is null;

update menus m
set course_count   = c.n,
    dish_signature = c.sig
from (select mc.menu_id,
             count(*)::integer                        as n,
             array_agg(mc.dish_key order by mc.dish_key) as sig
      from menu_courses mc
      group by mc.menu_id) c
where c.menu_id = m.id
  and m.dish_signature is null;

-- One reference per ORIGINAL menu, pointing at the earliest row of its
-- identity group. `created_at` is carried across deliberately: `useMenus`
-- orders newest-first and that ordering has to keep meaning "when I saved it",
-- or every saved-meals list reshuffles into insertion order on deploy. The
-- old `menus.name` becomes this profile's own `label` for the same reason.
--
-- `main_recipe_id` is omitted — the BEFORE trigger fills it from the menu, and
-- letting it do so here is a live check that it agrees with the collapse.
insert into saved_menus (profile_id, menu_id, label, created_at)
select m.profile_id,
       first_value(m.id) over (partition by m.main_recipe_id, m.dish_signature
           order by m.created_at, m.id),
       m.name,
       m.created_at
from menus m
where m.profile_id is not null
on conflict (profile_id, main_recipe_id) do nothing;

-- The duplicates, now that every profile that held one has a reference to the
-- survivor. Their courses cascade; nothing points at them.
delete
from menus m
where exists (select 1
              from menus k
              where k.main_recipe_id = m.main_recipe_id
                and k.dish_signature = m.dish_signature
                and (k.created_at, k.id) < (m.created_at, m.id));

------------------------------------------------------------------------------
-- 5. Constrain, now that the data satisfies it
------------------------------------------------------------------------------
--
-- Normalise first, constrain second — a constraint added over data that
-- violates it fails the whole migration, and "expected to touch nothing" is
-- not the same as knowing (20260815000004).

-- Authoritative rather than trusting the counter trigger's view of the inserts
-- above, which is the only place in this table's life the two could disagree.
update menus m
set saved_count = (select count(*) from saved_menus s where s.menu_id = m.id);

alter table menu_courses
    alter column dish_key set not null;

alter table menus
    alter column dish_signature set not null;

alter table menus
    drop constraint if exists menus_dish_signature_nonempty;

alter table menus
    add constraint menus_dish_signature_nonempty check (cardinality(dish_signature) > 0);

alter table menus
    drop constraint if exists menus_identity_key;

alter table menus
    add constraint menus_identity_key unique (main_recipe_id, dish_signature);

-- `main_recipe_id` is the leading column of that unique now, so the index
-- `20260819000002` added for the lookup-by-main path is redundant.
drop index if exists idx_menus_main_recipe_id;

create index if not exists idx_menus_owner_profile_id
    on menus using btree (owner_profile_id)
    where (owner_profile_id is not null);

comment on column menus.owner_profile_id is
    'Owning profile, or NULL for the shared corpus. Non-null means exactly one profile may read the menu (see menu_is_visible). Stored, never derived — see 20260821000001.';

comment on column menus.dish_signature is
    'Sorted menu_courses.dish_key. With main_recipe_id, the menu''s identity.';

comment on column menu_courses.dish_key is
    'Immutable identity token: the suggestion a dish descends from, or its recipe id. recipe_id is the as-saved pointer and may be stale; this never is.';

------------------------------------------------------------------------------
-- 6. The old policies go before the column they read
------------------------------------------------------------------------------
--
-- Both of them, and in this order. `users_manage_own_menu_courses` reads
-- `menus.profile_id` through a subquery, so it depends on the column just as
-- directly as the policy on `menus` does. Dropping the column with CASCADE
-- would take both silently, which is the same work done invisibly.

drop policy if exists users_manage_own_menus on menus;
drop policy if exists users_manage_own_menu_courses on menu_courses;

alter table menus
    drop column if exists profile_id;

------------------------------------------------------------------------------
-- 7. The rule, once
------------------------------------------------------------------------------

-- Argument-shaped and with NO `SET` clause, exactly like
-- `recipe_is_visible(created_by)` and for the stated reason: the planner
-- inlines it into the policies rather than calling it per row. Note this is the
-- opposite of `menu_is_publishable`'s old shape, which pinned a search_path
-- because it was only ever called from inside a definer function.
create or replace function public.menu_is_visible(p_owner_profile_id uuid)
    returns boolean
    language sql
    stable
as
$function$
select p_owner_profile_id is null
    or p_owner_profile_id = current_profile_id();
$function$;

comment on function public.menu_is_visible(uuid) is
    'The one menu visibility rule: unowned menus are the shared corpus, owned ones belong to one profile. Used by the RLS policies on menus and menu_courses.';

-- A policy expression is evaluated as the CALLER, so the caller needs EXECUTE
-- on anything it names. This is why the old `menu_is_publishable(uuid)` could
-- carry `revoke all … from public` and this cannot: dropped into a policy
-- unchanged, that would surface as `permission denied for function` on every
-- single menu read.
grant execute on function public.menu_is_visible(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- 8. The new policies
------------------------------------------------------------------------------
--
-- `to anon, authenticated` written out rather than left as the default `public`
-- (see 20260812000000) — the home feed's strip is shown to guests on purpose.

create policy public_read on menus for select to anon, authenticated
    using (menu_is_visible(owner_profile_id));

-- Restated over the parent rather than inherited from it. The subquery is
-- itself subject to `menus`' policy, so a hidden parent yields `not exists`
-- before `menu_is_visible` is even evaluated — the call is kept anyway,
-- because a child table's rule should say what it is rather than inherit it
-- from whichever policy happens to be on the parent this week. Verbatim the
-- argument `20260815000005` makes for `recipe_ingredients`.
create policy public_read on menu_courses for select to anon, authenticated
    using (exists (select 1
                   from menus m
                   where m.id = menu_courses.menu_id
                     and menu_is_visible(m.owner_profile_id)));

-- SELECT is the only policy either table gets: every write goes through
-- `save_menu` (20260821000002), which is SECURITY DEFINER.
--
-- The revoke is not redundant with the missing policies, and the difference is
-- the kind that costs an afternoon. With RLS on and no write policy, an INSERT
-- errors loudly — but an UPDATE or DELETE simply matches zero rows and returns
-- 204. A client still running the old `delete().eq("id", …)` would untoggle a
-- heart, invalidate, watch the menu come back, and have nothing to report.
revoke insert, update, delete on menus from anon, authenticated;
revoke insert, update, delete on menu_courses from anon, authenticated;

-- USING is the ordinary users_manage_own_* shape. WITH CHECK is written out
-- rather than left to fall back on USING, because it has a second job: that
-- `exists` runs under `menus`' own policy, so a menu the caller cannot see
-- yields NOT EXISTS and the insert is refused. Without it the foreign key is
-- the only test on `menu_id` — and FK checks bypass RLS, so a guessed uuid
-- would inflate `saved_count` on a menu its owner alone may read.
create policy users_manage_own_saved_menus on saved_menus for all to authenticated
    using (profile_id in (select profiles.id from profiles where profiles.user_id = auth.uid()))
    with check (profile_id in (select profiles.id from profiles where profiles.user_id = auth.uid())
        and exists (select 1 from menus m where m.id = saved_menus.menu_id));

notify pgrst, 'reload schema';
