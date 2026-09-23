-- ---------------------------------------------------------------------------
-- The admin console: who an admin is, and what "hidden" means.
--
-- Two things arrive together because neither is any use alone: a way to say
-- that one account may curate the catalogue, and something for it to curate
-- with.
--
-- ## 1. `profiles.is_admin`, and the hole it would have opened
--
-- `authenticated` holds table-wide UPDATE on `profiles` and the
-- `users_update_own_profile` policy lets a caller write their own row — so a
-- new boolean column is, by default, one PATCH away from being set by the
-- person it governs. RLS cannot restrain a COLUMN; only grants can. So the
-- table-wide grant is revoked and re-issued column by column, listing exactly
-- the seven that were updatable before this migration. **Anything added to
-- `profiles` from here is un-updatable by the client until it is named in that
-- grant**, which is the failure direction to want: a forgotten column is
-- read-only rather than a privilege nobody meant to hand out.
--
-- Admin powers themselves do NOT flow through RLS. The console talks to
-- `/rest/admin/*`, which runs as the service role and bypasses policies
-- entirely, after `requireAdmin` has read this column. `public.is_admin()`
-- exists anyway because the rule should have one home and a future policy
-- should not restate it.
--
-- ## 2. `hidden_at`, and why the signature of `recipe_is_visible` changed
--
-- Hiding is "gone for everyone" (owner's call, 2026-09-22), not "dropped from
-- discovery": a hidden dish leaves the feed, search, pairings, components and
-- the share link, AND stops resolving for the readers who saved it. That is
-- the stronger of the two and it is chosen knowingly — the cost is that a
-- favourite or a planned night pointing at a hidden dish renders with nothing
-- behind it, which is why the console counts those references and says so
-- before the press.
--
-- `recipe_is_visible(uuid)` could not express it: it is handed `created_by`
-- and nothing else, so it cannot see a row's own hidden state. The new
-- signature takes both and **the one-argument version is DROPPED**. That drop
-- is the point of the design rather than tidying: an overload would leave
-- every existing call site compiling, running, and silently not filtering.
-- Postgres refuses the drop while anything depends on it, so the five policies
-- and three functions below must be updated first — which is exactly the
-- review this change needs.
--
-- ## What must exclude a hidden recipe, and why each one is listed
--
-- RLS covers every ordinary read and every SECURITY INVOKER function
-- (`find_near_miss_recipes`, the whole menu family, `search_recipes`). What it
-- does not cover is a SECURITY DEFINER function, which sees past policies
-- entirely — so each one applies the rule in its own WHERE clause. The set was
-- not guessed; it is every function whose body names `recipes`, taken from
-- `pg_proc` against the live schema:
--
--   find_recipes                  DEFINER  the feed and search
--   find_dishes_using_components  DEFINER  "used in", both halves
--   pairing_candidates_for_recipe DEFINER  menu composition
--   record_ingredient_substitution DEFINER a write-side ownership guard
--   search_recipes                invoker  dedup, service-role caller
--
-- `search_recipes` is the one worth pausing on. It runs as the service role
-- during dedup with no user at all, so it asks "is this part of the shared
-- corpus", not "may I see it" — and a hidden dish is deliberately excluded
-- from that too. Hiding a bad render therefore lets the dish be generated
-- again rather than deduping every future attempt onto an invisible row, which
-- is the whole reason a curator reaches for the control.
--
-- KNOWN AND ACCEPTED, and it is `20260815000005`'s exception unchanged:
-- `recipe_display_tags` and `recipe_dietary` are views without
-- `security_invoker`, so they see past the policies and will still report a
-- hidden dish's TAG NAMES to a caller holding its id. No name, no picture, no
-- ingredients, no method. Revisit both together if that ever stops being true.
--
-- ## Suggestions hide too, and they are a different table
--
-- `recipe_suggestions.public_read` was `using (true)`, so the flag goes into
-- the policy directly. Its two child tables were `using (true)` as well, which
-- left a hidden suggestion's ingredients and tags readable by id — the exact
-- hole `20260815000005` closed for recipes, still open here because nothing
-- had ever been hidden before. They resolve through the parent now.
-- ---------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Who is an admin
------------------------------------------------------------------------------

alter table public.profiles
    add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
    'Grants the admin console. Read by requireAdmin in apps/api, which then acts as the service role. NOT client-writable: see the column grants below.';

-- RLS governs rows, never columns. `users_update_own_profile` passes for a
-- caller editing their own profile, so without this the column is settable by
-- the account it governs. Re-granted by name, exactly the set that was
-- updatable before — `is_admin` is simply absent from it.
revoke update on public.profiles from anon, authenticated;

grant update (avatar_url, created_at, display_name, id, onboarding_completed, updated_at, user_id)
    on public.profiles to authenticated;

create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, pg_temp
as $function$
select exists (select 1
               from public.profiles p
               where p.user_id = auth.uid()
                 and p.is_admin);
$function$;

comment on function public.is_admin() is
    'True when the calling auth user holds the admin flag. SECURITY DEFINER because profiles is readable only to its owner. The API reads the column directly as the service role; this exists so a policy never has to restate the rule.';

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

------------------------------------------------------------------------------
-- 2. What "hidden" is
------------------------------------------------------------------------------

alter table public.recipes
    add column if not exists hidden_at timestamptz,
    add column if not exists hidden_by uuid references public.profiles (id) on delete set null,
    add column if not exists hidden_reason text;

comment on column public.recipes.hidden_at is
    'Set by the admin console. Non-null removes the dish from every read path, including for readers who saved it. Never deleted: hiding is reversible and the row is what a reader''s favourite still points at.';
comment on column public.recipes.hidden_reason is
    'Free text, admin-facing only. Never rendered to a reader — there is no surface that would have anything to say to them.';

alter table public.recipe_suggestions
    add column if not exists hidden_at timestamptz,
    add column if not exists hidden_by uuid references public.profiles (id) on delete set null,
    add column if not exists hidden_reason text;

-- Partial, because the hidden set is small by construction and every read
-- filters for NULL. The index earns nothing on the common path; it is here for
-- the console's own "what have I hidden" list.
create index if not exists idx_recipes_hidden_at
    on public.recipes (hidden_at desc) where hidden_at is not null;

create index if not exists idx_recipe_suggestions_hidden_at
    on public.recipe_suggestions (hidden_at desc) where hidden_at is not null;

------------------------------------------------------------------------------
-- 3. The visibility rule, restated with one more argument
------------------------------------------------------------------------------

create or replace function public.recipe_is_visible(p_created_by uuid, p_hidden_at timestamptz)
    returns boolean
    language sql
    stable
as $function$
select p_hidden_at is null
    and (p_created_by is null or p_created_by = current_profile_id());
$function$;

comment on function public.recipe_is_visible(uuid, timestamptz) is
    'The one recipe visibility rule: unowned rows are the shared catalogue, owned rows belong to one profile, and a hidden row belongs to nobody. Used by the recipes RLS policies AND by the SECURITY DEFINER readers, which never consult a policy.';

alter policy public_read on public.recipes
    using (recipe_is_visible(created_by, hidden_at));

alter policy public_read on public.recipe_ingredients
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_ingredients.recipe_id
                     and recipe_is_visible(r.created_by, r.hidden_at)));

alter policy public_read on public.recipe_instructions
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_instructions.recipe_id
                     and recipe_is_visible(r.created_by, r.hidden_at)));

alter policy public_read on public.recipe_tags
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_tags.recipe_id
                     and recipe_is_visible(r.created_by, r.hidden_at)));

alter policy public_read on public.recipe_components
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_components.recipe_id
                     and recipe_is_visible(r.created_by, r.hidden_at)));

-- The suggestion half. `using (true)` on all three until now, which is why the
-- two child tables are tightened here rather than in a migration of their own:
-- a hidden suggestion whose ingredients are still readable is not hidden.
alter policy public_read on public.recipe_suggestions
    using (hidden_at is null);

alter policy public_read on public.recipe_suggestion_ingredients
    using (exists (select 1
                   from recipe_suggestions s
                   where s.id = recipe_suggestion_ingredients.recipe_suggestion_id
                     and s.hidden_at is null));

alter policy public_read on public.recipe_suggestion_tags
    using (exists (select 1
                   from recipe_suggestions s
                   where s.id = recipe_suggestion_tags.recipe_suggestion_id
                     and s.hidden_at is null));

------------------------------------------------------------------------------
-- 4. The SECURITY DEFINER readers, restated
------------------------------------------------------------------------------
--
-- Each body below is the live definition taken verbatim from
-- `pg_get_functiondef`, with the one predicate added and marked `THE EDIT
-- (20260922000001)` — the convention `20260815000006` and `20260902000001`
-- already use here. Re-dumping rather than re-deriving is deliberate: these
-- are large and several have been rewritten more than once, so a hand-rebuilt
-- copy is how an earlier migration's fix gets silently reverted.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_recipes(p_difficulty text DEFAULT NULL::text, ingredients uuid[] DEFAULT ARRAY[]::uuid[], tags uuid[] DEFAULT ARRAY[]::uuid[], blacklist uuid[] DEFAULT ARRAY[]::uuid[], limit_count integer DEFAULT 10, p_offset integer DEFAULT 0, p_pantry uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS SETOF find_recipes_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
difficulty_filter text := null;
  -- Counted off the raw argument, not off the resolved `requested` CTE below,
  -- so an id that matches no tag row makes the filter unsatisfiable instead of
  -- being quietly ignored. For a restriction, failing closed is the only safe
  -- direction.
  requested_tag_count integer := (select count(distinct t) from unnest(tags) as t);
  -- THE EDIT (20260902000001). Same construction as the tag count above and for
  -- the same reason: the requirement is one satisfied REQUEST, not one matched
  -- id, so the identity closure below must not be allowed to inflate it.
  requested_ingredient_count integer := (select count(distinct t) from unnest(ingredients) as t);
  -- Flat closures. Both are membership tests ("does this dish contain any of
  -- them"), so unlike the ingredient filter they need no per-request grouping.
  blacklist_ids uuid[] := ingredient_identity_ids(blacklist);
  pantry_ids uuid[] := ingredient_identity_ids(p_pantry);
  -- Resolved once. Every pantry expression below is guarded on it, which is what
  -- makes a call with no pantry produce the ordering this function had before.
  pantry_empty boolean := coalesce(array_length(pantry_ids, 1), 0) = 0;
begin
  -- Normalize difficulty preference
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
  /* -------------------------------------------------
   * 0a. Each requested tag, resolved, and how it must be satisfied: a derivable
   * diet is answered from the ingredients, everything else from the tags the
   * row carries.
   * ------------------------------------------------- */
  requested as (
    select distinct
      t.id,
      t.canonical_id,
      (dr.diet_canonical_id is not null) as is_derived_diet
    from unnest(tags) as req(id)
    join tags t on t.id = req.id
    left join dietary_rules dr
      on t.type = 'dietary'
     and dr.diet_canonical_id = t.canonical_id
  ),

  /* -------------------------------------------------
   * 0b. Subtree expansion for the tag-matched ones (see 20260803000002).
   * ------------------------------------------------- */
  requested_tags as (
    select s.root_id, s.tag_id
    from tag_subtree(array(select id from requested where not is_derived_diet)) s
  ),

  /* -------------------------------------------------
   * 0c. THE EDIT (20260902000001). One row per REQUESTED ingredient, carrying
   * every id that is the same thing. The dish has to satisfy each row, not each
   * id — see the header on why flattening this into one wide array would make
   * the filter stricter rather than looser.
   * ------------------------------------------------- */
  requested_ingredients as (
    select distinct req.id as request_id,
           ingredient_identity_ids(array [req.id]) as group_ids
    from unnest(ingredients) as req(id)
  ),

  /* -------------------------------------------------
   * 1a. Every recipe passing the hard filters — variants INCLUDED.
   * ------------------------------------------------- */
  matching_recipes as (
    select
      r.id,
      r.name,
      r.description,
      r.short_description,
      r.image,
      r.difficulty::text as difficulty,
      r.favourite_count,
      r.identity_cuisine,
      -- The time band's only input.
      r.total_time_minutes,
      -- Provenance, carried alongside the difficulty pick below because a
      -- family can in principle mix an imported base with generated variants.
      r.origin,
      -- A dish's family: its base's id, or its own when it IS the base.
      coalesce(r.base_recipe_id, r.id) as family_id,
      r.base_recipe_id
    from recipes r
    where
      -- THE EDIT (20260815000006). The shared catalogue, plus this caller's own
      -- recipes. First in the WHERE because it is the cheapest predicate here
      -- and the only one that is about who is asking rather than what they
      -- asked for.
      -- THE EDIT (20260922000001). Two arguments now: a hidden dish is
      -- visible to nobody, including the profile that owns it.
      recipe_is_visible(r.created_by, r.hidden_at)
      and (
        requested_ingredient_count = 0
        or (
          -- THE EDIT (20260902000001). Was a single count over
          -- `ri.ingredient_id = any (ingredients)`; now one satisfied request
          -- per requested id, which is what makes "All Purpose Flour" find the
          -- 75 dishes that list "Flour".
          select count(*)
          from requested_ingredients q
          where exists (
            select 1
            from recipe_ingredients ri
            where ri.recipe_id = r.id
              and ri.ingredient_id = any (q.group_ids)
          )
        ) = requested_ingredient_count
      )
      and (
        coalesce(array_length(blacklist_ids, 1), 0) = 0
        or not exists (
          select 1
          from recipe_ingredients rib
          where rib.recipe_id = r.id
            -- THE EDIT (20260902000001). Closed over the alias identity, so
            -- excluding Ground Pork also excludes the Minced Pork row.
            and rib.ingredient_id = any (blacklist_ids)
        )
      )
      and (
        requested_tag_count = 0
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_dietary rd
                where rd.recipe_id = r.id
                  and rd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_tags rt
                  on rt.recipe_id = r.id
                 and rt.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 1a-ii. THE EDIT (20260902000001). How much of this dish the reader already
   * has, and how much of it they do not.
   *
   * One grouped pass over the junction table for the whole matching set, rather
   * than two correlated subqueries per row: the per-row form is
   * recipes × pantry_size comparisons and this is linear in
   * `recipe_ingredients`, which is what keeps it flat as the catalogue grows.
   *
   * Staples are dropped from the input, so they count on NEITHER side. A dish
   * with nothing but staples produces no row here at all and coalesces to 0/0 —
   * which the `(pantry_have = 0)` key below then sorts to the tail, where a
   * dish the fridge did not reach belongs.
   *
   * `not pantry_empty` is what makes the whole feature inert for a caller that
   * passes no pantry: with no rows here, every recipe coalesces to 0/0 and the
   * three ordering keys are constant.
   * ------------------------------------------------- */
  pantry_recipe_stats as (
    select ri.recipe_id,
           count(*) filter (where ri.ingredient_id = any (pantry_ids))::integer       as have,
           count(*) filter (where not (ri.ingredient_id = any (pantry_ids)))::integer as missing
    from matching_recipes m
    join recipe_ingredients ri on ri.recipe_id = m.id
    join ingredients i on i.id = ri.ingredient_id
    where not pantry_empty
      and not exists (
        select 1 from pantry_staples s where s.canonical_id = i.canonical_id
      )
    group by ri.recipe_id
  ),

  /* -------------------------------------------------
   * 1b. One row per dish — the copy closest to the requested difficulty.
   *
   * Note the band travels WITH the difficulty pick rather than being read
   * separately: an easy and a hard copy of one dish have different times, and
   * the pill has to describe the copy actually being shown.
   *
   * The pantry numbers travel with it for the same reason — the two copies of a
   * dish can list different ingredients, so the counts have to describe the copy
   * actually being shown. They deliberately do NOT participate in choosing it:
   * which rung of a family a reader gets is a question about their skill, and
   * letting the fridge answer it would hand a beginner the hard version for
   * owning a spice.
   * ------------------------------------------------- */
  family_picks as (
    select distinct on (m.family_id)
      m.id,
      m.name,
      m.description,
      m.short_description,
      m.image,
      m.difficulty,
      m.favourite_count,
      m.identity_cuisine,
      m.total_time_minutes,
      -- Of the copy actually being shown, for the same reason the band is.
      m.origin,
      coalesce(ps.have, 0) as pantry_have,
      coalesce(ps.missing, 0) as pantry_missing
    from matching_recipes m
    left join pantry_recipe_stats ps on ps.recipe_id = m.id
    order by
      m.family_id,
      difficulty_preference_rank(m.difficulty, difficulty_filter),
      -- Equal distance: prefer the base, which carries the likes and the image.
      (m.base_recipe_id is not null),
      m.id
  ),

  /* -------------------------------------------------
   * 1c. Difficulty orders rather than narrows.
   * ------------------------------------------------- */
  candidate_recipes as (
    select *
    from family_picks f
    order by
      difficulty_preference_rank(f.difficulty, difficulty_filter),
      -- THE EDIT (20260902000001). The pantry keys are here as well as in the
      -- final ORDER BY, and they have to be: this LIMIT is what decides which
      -- dishes reach the page at all, so a pantry order applied only at the end
      -- would reorder the alphabetically-first twelve and nothing else.
      -- Constant when no pantry is passed, so this reduces to the previous
      -- (difficulty, name) truncation exactly.
      (f.pantry_have = 0),
      f.pantry_missing,
      f.pantry_have desc,
      f.name
    -- Must cover the whole requested WINDOW, not just its length. This is a
    -- performance guard — `recipe_rows` below runs two jsonb aggregates per row,
    -- so the pool is cut before that rather than after — and it was written when
    -- there was only ever one page, where `limit_count` was the window.
    --
    -- With an offset it silently truncated the catalogue: at limit 12 offset 12
    -- this produced the FIRST 12 recipes, the final OFFSET then skipped all of
    -- them, and page two opened on suggestions while recipes 13+ were
    -- unreachable at any offset. Recipes must be exhausted before a suggestion
    -- is shown, and that is exactly what broke.
    limit limit_count + greatest(p_offset, 0)
  ),

  /* -------------------------------------------------
   * 2. Recipes with relations
   * ------------------------------------------------- */
  recipe_rows as (
    select
      c.id,
      c.name,
      c.description,
      c.short_description,
      c.image,
      c.difficulty,
      c.favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_ingredients ri on ri.ingredient_id = i.id
        where ri.recipe_id = c.id
      ), '[]'::jsonb) as ingredients,
      -- Display tags, not raw recipe_tags: a dietary chip now says what the
      -- ingredients say, which is what the filter above answered from.
      -- `type` included so the client can single out the cuisine tag (or any
      -- other type) without name-matching.
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_display_tags dt
        where dt.recipe_id = c.id
      ), '[]'::jsonb) as tags,
      'recipe'::text as source,
      c.total_time_minutes,
      c.origin,
      -- LAST, matching the attributes appended to the result type.
      c.pantry_have,
      c.pantry_missing,
      -- What to buy, named. The client cannot compute this itself — it does not
      -- hold the staples list or the alias identity groups, so a client-side
      -- difference against its own pantry would disagree with the count beside
      -- it. Only over the page, so it costs one more subquery on at most
      -- `limit_count + p_offset` rows.
      case
        when pantry_empty then '[]'::jsonb
        else coalesce((
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name)
            order by i.name
          )
          from ingredients i
          join recipe_ingredients ri on ri.ingredient_id = i.id
          where ri.recipe_id = c.id
            and not (i.id = any (pantry_ids))
            and not exists (
              select 1 from pantry_staples s where s.canonical_id = i.canonical_id
            )
        ), '[]'::jsonb)
      end as pantry_missing_ingredients
    from candidate_recipes c
  ),

  /* -------------------------------------------------
   * 3. Suggestion candidates (fallback)
   * ------------------------------------------------- */
  suggestion_candidates as (
    select
      rs.id,
      rs.name,
      rs.description,
      rs.difficulty::text as difficulty,
      -- The generator's estimate. NULL on anything written before
      -- 20260812000004, which the client renders as no pill.
      rs.total_time_minutes
    from recipe_suggestions rs
    where
      -- THE EDIT (20260922000001). SECURITY DEFINER, so the suggestion
      -- policy below never runs and the flag is applied by hand.
      rs.hidden_at is null
      and
      -- A promoted dish hides its own stale suggestion row. Keyed on
      -- (canonical name, identity cuisine) since 20260812000003: on the name
      -- alone, a promoted Turkish Manti RECIPE permanently hid a Kazakh Manti
      -- SUGGESTION from the feed, which would have undone the write-side split
      -- one layer further out.
      --
      -- `not exists`, not `not in`: `identity_cuisine` is nullable, and a single
      -- NULL anywhere in a `not in` subquery makes the whole predicate NULL and
      -- silently suppresses EVERY suggestion.
      --
      -- Null on either side merges, matching the write path — it is "unknown",
      -- not a distinct identity, so an un-backfilled row keeps behaving exactly
      -- as it does today. Ancestor-related cuisines are deliberately NOT
      -- resolved here: that needs a recursive subtree walk per row, and the
      -- write path already collapses those before two rows can exist.
      --
      -- Reads `family_picks`, which is owner-scoped — so one user's import can
      -- no longer hide a suggestion from anybody else, and cannot hide one from
      -- its own owner either, since for them it IS the same dish.
      --
      -- THE EDIT (20260823000001). It used to read `candidate_recipes`, which is
      -- `family_picks` TRUNCATED to `limit_count + p_offset` — so whether a
      -- suggestion was suppressed depended on which PAGE was being asked for. A
      -- recipe outside the current window could not hide its own suggestion, and
      -- the same dish came back twice: once as a recipe with an illustration,
      -- once as an idea offering to write the recipe that already exists.
      --
      -- It has not fired yet because recipes are exhausted before a suggestion
      -- is reached, which puts the whole catalogue inside the window by the time
      -- it matters. That stops being true the moment the truncation is ever
      -- loosened or the ordering changed, and the failure is silent.
      not exists (
        select 1
        from family_picks c
        where regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '_', 'g') = rs.canonical_id
          and (
            c.identity_cuisine is null
            or rs.identity_cuisine is null
            or c.identity_cuisine = rs.identity_cuisine
          )
      )
      and (
        requested_ingredient_count = 0
        or (
          -- THE EDIT (20260902000001). The recipe half's rule, applied to the
          -- suggestion half — the two must agree about what an ingredient is or
          -- one feed would hold a dish the other could not find.
          select count(*)
          from requested_ingredients q
          where exists (
            select 1
            from recipe_suggestion_ingredients rsi
            where rsi.recipe_suggestion_id = rs.id
              and rsi.ingredient_id = any (q.group_ids)
          )
        ) = requested_ingredient_count
      )
      and (
        coalesce(array_length(blacklist_ids, 1), 0) = 0
        or not exists (
          select 1
          from recipe_suggestion_ingredients rsib
          where rsib.recipe_suggestion_id = rs.id
            and rsib.ingredient_id = any (blacklist_ids)
        )
      )
      and (
        requested_tag_count = 0
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_suggestion_dietary rsd
                where rsd.recipe_suggestion_id = rs.id
                  and rsd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_suggestion_tags rst
                  on rst.recipe_suggestion_id = rs.id
                 and rst.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 3a-ii. THE EDIT (20260902000001). The recipe stats, for the ideas half.
   *
   * Suggestions are not truncated before the final ORDER BY the way recipes
   * are, so these only have to reach `suggestion_rows`.
   * ------------------------------------------------- */
  pantry_suggestion_stats as (
    select rsi.recipe_suggestion_id as suggestion_id,
           count(*) filter (where rsi.ingredient_id = any (pantry_ids))::integer       as have,
           count(*) filter (where not (rsi.ingredient_id = any (pantry_ids)))::integer as missing
    from suggestion_candidates sc
    join recipe_suggestion_ingredients rsi on rsi.recipe_suggestion_id = sc.id
    join ingredients i on i.id = rsi.ingredient_id
    where not pantry_empty
      and not exists (
        select 1 from pantry_staples s where s.canonical_id = i.canonical_id
      )
    group by rsi.recipe_suggestion_id
  ),

  /* -------------------------------------------------
   * 3b. Every dish-form tag carried by anything these filters match, counted.
   *
   * Over the WHOLE matching set, not over the page — which is the only version
   * of this worth sending. Counted off the 12 rows a page happens to contain,
   * a facet chip says "Noodles" or stays silent depending on alphabetical
   * order, and the reader is offered a narrowing that is an artefact of paging.
   *
   * Unaffected by the pantry, deliberately: it ranks, it does not filter, so
   * the matching set is the same set it was and a facet count that moved with
   * somebody's fridge would be describing the sort order.
   *
   * Dish form and not course: `course` is four slots and is a SECTION question
   * (see the client's `COURSE_SLOTS`), while dish form is ~20 shallow buckets
   * that only make sense as a filter. Read off the DISPLAY views so a chip can
   * only ever name a tag the cards under it also show.
   *
   * Both halves of the feed contribute. A cuisine whose catalogue is mostly
   * unwritten would otherwise offer chips describing the few recipes it has and
   * nothing about the ideas that make up most of the list.
   * ------------------------------------------------- */
  facet_counts as (
    select links.tag_id as id, links.tag_name as name, count(*)::integer as n
    from (
      select dt.id as tag_id, dt.name as tag_name
      from family_picks f
      join recipe_display_tags dt on dt.recipe_id = f.id
      where dt.type = 'dish_form'
      union all
      select dt.id, dt.name
      from suggestion_candidates sc
      join recipe_suggestion_display_tags dt
        on dt.recipe_suggestion_id = sc.id
      where dt.type = 'dish_form'
    ) links
    group by links.tag_id, links.tag_name
  ),

  /* -------------------------------------------------
   * 3c. The chips, ordered by how much of the result each one accounts for.
   *
   * Capped at twelve: past that a rail is a second list rather than a way
   * through the first one, and the tail is single-dish buckets that narrow to
   * exactly the row the reader can already see.
   * ------------------------------------------------- */
  facet_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', t.id, 'name', t.name, 'count', t.n)
        order by t.n desc, t.name
      ),
      '[]'::jsonb
    ) as facets
    from (
      select fc.id, fc.name, fc.n
      from facet_counts fc
      order by fc.n desc, fc.name
      limit 12
    ) t
  ),

  /* -------------------------------------------------
   * 4. Suggestions with relations
   * ------------------------------------------------- */
  suggestion_rows as (
    select
      sc.id,
      sc.name,
      sc.description,
      -- Already a single generated line: it is its own short form.
      sc.description as short_description,
      null::text as image,
      sc.difficulty,
      0 as favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_suggestion_ingredients rsi
          on rsi.ingredient_id = i.id
        where rsi.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as ingredients,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_suggestion_display_tags dt
        where dt.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as tags,
      'suggestion'::text as source,
      sc.total_time_minutes,
      -- NULL because a suggestion has no provenance: nobody has written the
      -- dish down yet. In the same position as `recipe_rows` above — the union
      -- below matches on position, not on name.
      null::text as origin,
      coalesce(sps.have, 0) as pantry_have,
      coalesce(sps.missing, 0) as pantry_missing,
      case
        when pantry_empty then '[]'::jsonb
        else coalesce((
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name)
            order by i.name
          )
          from ingredients i
          join recipe_suggestion_ingredients rsi
            on rsi.ingredient_id = i.id
          where rsi.recipe_suggestion_id = sc.id
            and not (i.id = any (pantry_ids))
            and not exists (
              select 1 from pantry_staples s where s.canonical_id = i.canonical_id
            )
        ), '[]'::jsonb)
      end as pantry_missing_ingredients
    from suggestion_candidates sc
    left join pantry_suggestion_stats sps on sps.suggestion_id = sc.id
  ),

  /* -------------------------------------------------
   * 5. Combine and enforce limit
   * ------------------------------------------------- */
  combined as (
    select * from recipe_rows
    union all
    select * from suggestion_rows
  )

-- Every column is alias-qualified: `ingredients` and `tags` are also parameter
-- names on this function, so a bare column list here is ambiguous.
select
  c.id,
  c.name,
  c.description,
  c.short_description,
  c.image,
  c.difficulty,
  c.favourite_count,
  c.ingredients,
  c.tags,
  c.source,
  c.total_time_minutes,
  c.origin,
  -- In `add attribute` order — the composite type appends, and a mismatch here
  -- is a per-row runtime error rather than a build failure.
  tr.total_recipes,
  ts.total_suggestions,
  fj.facets,
  c.pantry_have,
  c.pantry_missing,
  c.pantry_missing_ingredients
from combined c
-- Uncorrelated, so they are evaluated once per call and attached to every row
-- rather than recomputed per row. Repeating them across a page is the cost of
-- `setof` having no header; it is three small values against twelve rows that
-- already carry two jsonb aggregates each.
--
-- `total_recipes` counts DISHES, not rows: `family_picks` has already collapsed
-- each family to the copy closest to the requested difficulty, so a dish with
-- an easy, a medium and a hard version counts once. That is what the header
-- line means by "104 recipes".
--
-- Both are unaffected by `p_pantry`, which is the whole claim of this being a
-- ranking rather than a filter: the result set is the same size and holds the
-- same dishes, in a different order.
cross join (select count(*)::integer as total_recipes from family_picks) tr
cross join (select count(*)::integer as total_suggestions from suggestion_candidates) ts
cross join facet_json fj
-- Real recipes before suggestions, then closest-to-preference, then best fit
-- for what is in the fridge, then most liked, then by name.
order by
  case c.source when 'recipe' then 0 else 1 end,
  difficulty_preference_rank(c.difficulty, difficulty_filter),
  -- THE EDIT (20260902000001). A dish the fridge did not reach at all sorts
  -- behind every dish it did — which is what stops an all-staples dish (have 0,
  -- missing 0) and a tiny dish you have neither half of from topping a feed
  -- ordered on "fewest to buy".
  (c.pantry_have = 0),
  -- The primary pantry key: fewest things to buy. "Uses the most of what I
  -- have" is the other ranking and it is the wrong one — measured, it leads
  -- with a dish using five of your items and needing six more.
  c.pantry_missing,
  -- Ties broken by how much of the fridge the dish uses. Identical in effect to
  -- ordering by coverage, which is monotonic in this once `missing` is fixed.
  c.pantry_have desc,
  -- The only signal of "best" this schema has. Below the difficulty tier
  -- because skill level is a stated preference and a like count is inferred
  -- taste; a hard dish should not outrank an easy one for a beginner just for
  -- being popular. Now also below the pantry, on the same argument in the other
  -- direction: what this reader has in the fridge tonight beats what everybody
  -- else liked.
  --
  -- Only ever separates RECIPES: `suggestion_rows` reports 0 for every
  -- suggestion (nothing can favourite one), and they already sit in the lower
  -- source tier, so this cannot reorder them among themselves.
  c.favourite_count desc,
  c.name,
  -- Total order, which OFFSET pagination requires and the first three keys do
  -- not give: two difficulties of one dish share a name, and can tie on the
  -- preference rank too (easy and hard sit the same distance from medium). Any
  -- tie there lets a row shift between pages and be served twice or skipped.
  c.id
limit limit_count offset greatest(p_offset, 0);

end;
$function$

;

CREATE OR REPLACE FUNCTION public.search_recipes(query_embedding vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, score double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
    return query
        select r.id,
               r.name,
               1 - (r.fts <=> query_embedding) as score
        from recipes r
        where r.fts is not null
          and r.base_recipe_id is null
          -- The one edit. NOT recipe_is_visible(): this caller is the service
          -- role running dedup with no user at all, so "visible to me" is the
          -- wrong question — "is it part of the shared corpus" is the right one,
          -- and it must answer the same way whoever is asking.
          and r.created_by is null
          -- THE EDIT (20260922000001). A hidden dish leaves the corpus
          -- for dedup too, so hiding a bad render lets the dish be
          -- written again instead of deduping every attempt onto it.
          and r.hidden_at is null
          and 1 - (r.fts <=> query_embedding) >= match_threshold
        order by r.fts <=> query_embedding
        limit match_count;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.record_ingredient_substitution(p_recipe_ingredient_id uuid, p_substitute_name text, p_ratio text DEFAULT NULL::text)
 RETURNS profile_ingredient_substitutions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_profile_id   uuid := current_profile_id();
    v_recipe_id    uuid;
    v_ingredient   uuid;
    v_replaced     text;
    v_recipe_owner uuid;
    v_recipe_hidden timestamptz;
    v_substitute   text;
    v_sub_id       uuid;
    v_dish_form    text;
    v_cuisine      text;
    v_row          profile_ingredient_substitutions;
begin
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'record_ingredient_substitution: no profile for the current user';
    end if;

    select ri.recipe_id, ri.ingredient_id, i.canonical_id, r.created_by, r.hidden_at
    into v_recipe_id, v_ingredient, v_replaced, v_recipe_owner, v_recipe_hidden
    from recipe_ingredients ri
             join ingredients i on i.id = ri.ingredient_id
             join recipes r on r.id = ri.recipe_id
    where ri.id = p_recipe_ingredient_id;

    if not found then
        raise exception using
            errcode = 'no_data_found',
            message = format('record_ingredient_substitution: no recipe ingredient %s',
                             p_recipe_ingredient_id);
    end if;

    -- SECURITY DEFINER sees past the `recipes` policy, so the visibility rule is
    -- applied here by hand. Without it this is a way to confirm that somebody
    -- else's imported recipe exists and contains a given ingredient.
    if not recipe_is_visible(v_recipe_owner, v_recipe_hidden) then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'record_ingredient_substitution: recipe belongs to another profile';
    end if;

    v_substitute := ingredient_canonical_id(p_substitute_name);

    -- `ingredient_canonical_id` answers '' for punctuation-only input rather
    -- than NULL, and the table's check would reject it a moment later; refusing
    -- here names the reason.
    if coalesce(v_substitute, '') = '' then
        raise exception using
            errcode = 'check_violation',
            message = 'record_ingredient_substitution: substitute name canonicalises to nothing';
    end if;

    -- NULL when the chosen swap names nothing in the catalogue, which is the
    -- ordinary case for "Leave it out" and for anything the model invented a
    -- phrase for. Not an error: the name and canonical id above are the record.
    select i.id into v_sub_id from ingredients i where i.canonical_id = v_substitute;

    select max(t.name) filter (where t.type = 'dish_form'),
           max(t.name) filter (where t.type = 'cuisine')
    into v_dish_form, v_cuisine
    from recipe_tags rt
             join tags t on t.id = rt.tag_id
    where rt.recipe_id = v_recipe_id;

    insert into profile_ingredient_substitutions (profile_id, recipe_id, recipe_ingredient_id,
                                                  replaced_ingredient_id, replaced_canonical_id,
                                                  substitute_name, substitute_canonical_id,
                                                  substitute_ingredient_id, ratio,
                                                  dish_form, cuisine)
    values (v_profile_id, v_recipe_id, p_recipe_ingredient_id,
            v_ingredient, v_replaced,
            trim(p_substitute_name), v_substitute,
            v_sub_id, nullif(trim(coalesce(p_ratio, '')), ''),
            v_dish_form, v_cuisine)
    on conflict (profile_id, recipe_ingredient_id)
        do update set substitute_name          = excluded.substitute_name,
                      substitute_canonical_id  = excluded.substitute_canonical_id,
                      substitute_ingredient_id = excluded.substitute_ingredient_id,
                      ratio                    = excluded.ratio,
                      -- Re-snapshotted: the row now describes the swap in force,
                      -- and the context it is in force in.
                      dish_form                = excluded.dish_form,
                      cuisine                  = excluded.cuisine,
                      updated_at               = now()
    returning * into v_row;

    return v_row;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.find_dishes_using_components(p_components uuid[], p_blacklist uuid[] DEFAULT '{}'::uuid[], p_dietary_tags uuid[] DEFAULT '{}'::uuid[], p_exclude_dish_ids uuid[] DEFAULT '{}'::uuid[], p_limit integer DEFAULT 5)
 RETURNS SETOF find_recipes_result
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with
    requested as (select distinct unnest(p_components) as req_id),
    -- Each requested component closed over `ingredient_aliases`, in both
    -- directions and transitively — the same closure `find_recipes` applies to
    -- its ingredient ids. A component reached through an alias is the same
    -- component.
    --
    -- **Expanded PER REQUESTED ID, never flattened into one set.** Closing two
    -- requests into four ids and then counting distinct matches would demand all
    -- four, which makes the filter HARDER rather than wider — the exact trap
    -- `20260902000001` records for `p_pantry`. The count below is over `req_id`
    -- for that reason.
    expanded as (
        select r.req_id,
               unnest(public.ingredient_identity_ids(array [r.req_id])) as ingredient_id
        from requested r
    ),
    wanted as (select count(*)::int as n from requested),
    -- Every dish carrying ALL the requested components.
    matched as (
        select dc.dish_id, dc.source
        from public.dish_components dc
        join expanded e on e.ingredient_id = dc.ingredient_id
        group by dc.dish_id, dc.source
        having count(distinct e.req_id) = (select n from wanted)
    ),
    recipes_matched as (
        select r.id,
               r.name,
               r.description,
               r.short_description,
               r.image,
               r.difficulty::text,
               coalesce(r.favourite_count, 0) as favourite_count,
               r.total_time_minutes,
               'recipe'::text as source,
               r.origin::text as origin
        from matched m
        join public.recipes r on r.id = m.dish_id
        where m.source = 'recipe'
          -- SECURITY DEFINER, so no policy applies and the rule is written out.
          -- An owned (imported) recipe is nobody else's to retrieve.
          and r.created_by is null
          -- THE EDIT (20260922000001).
          and r.hidden_at is null
          and not (r.id = any (p_exclude_dish_ids))
          and (
              cardinality(p_blacklist) = 0
              or not exists (
                  select 1 from public.recipe_ingredients ri
                  where ri.recipe_id = r.id
                    and ri.ingredient_id = any (
                        public.ingredient_identity_ids(p_blacklist)
                    )
              )
          )
          and (
              cardinality(p_dietary_tags) = 0
              or not exists (
                  select 1 from unnest(p_dietary_tags) as want(tag_id)
                  where not exists (
                      select 1 from public.recipe_dietary rd
                      join public.tags t on t.canonical_id = rd.diet_canonical_id
                      where rd.recipe_id = r.id and t.id = want.tag_id
                  )
                  and not exists (
                      select 1 from public.recipe_tags rt
                      where rt.recipe_id = r.id and rt.tag_id = want.tag_id
                  )
              )
          )
    ),
    suggestions_matched as (
        select s.id,
               s.name,
               s.description,
               s.description as short_description,
               null::text as image,
               s.difficulty::text,
               0 as favourite_count,
               s.total_time_minutes,
               'suggestion'::text as source,
               'generated'::text as origin
        from matched m
        join public.recipe_suggestions s on s.id = m.dish_id
        where m.source = 'suggestion'
          -- THE EDIT (20260922000001).
          and s.hidden_at is null
          and not (s.id = any (p_exclude_dish_ids))
          and (
              cardinality(p_blacklist) = 0
              or not exists (
                  select 1 from public.recipe_suggestion_ingredients si
                  where si.recipe_suggestion_id = s.id
                    and si.ingredient_id = any (
                        public.ingredient_identity_ids(p_blacklist)
                    )
              )
          )
          and (
              cardinality(p_dietary_tags) = 0
              or not exists (
                  select 1 from unnest(p_dietary_tags) as want(tag_id)
                  where not exists (
                      select 1 from public.recipe_suggestion_dietary sd
                      join public.tags t on t.canonical_id = sd.diet_canonical_id
                      where sd.recipe_suggestion_id = s.id and t.id = want.tag_id
                  )
                  and not exists (
                      select 1 from public.recipe_suggestion_tags st
                      where st.recipe_suggestion_id = s.id and st.tag_id = want.tag_id
                  )
              )
          )
    ),
    combined as (
        select * from recipes_matched
        union all
        select * from suggestions_matched
    )
select c.id,
       c.name,
       c.description,
       c.short_description,
       c.image,
       c.difficulty,
       c.favourite_count,
       coalesce(
           (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name)
                             order by i.name)
            from public.recipe_ingredients ri
            join public.ingredients i on i.id = ri.ingredient_id
            where c.source = 'recipe' and ri.recipe_id = c.id),
           (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name)
                             order by i.name)
            from public.recipe_suggestion_ingredients si
            join public.ingredients i on i.id = si.ingredient_id
            where c.source = 'suggestion' and si.recipe_suggestion_id = c.id),
           '[]'::jsonb
       ) as ingredients,
       coalesce(
           (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)
                             order by t.name)
            from public.recipe_tags rt
            join public.tags t on t.id = rt.tag_id
            where c.source = 'recipe' and rt.recipe_id = c.id),
           (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)
                             order by t.name)
            from public.recipe_suggestion_tags st
            join public.tags t on t.id = st.tag_id
            where c.source = 'suggestion' and st.recipe_suggestion_id = c.id),
           '[]'::jsonb
       ) as tags,
       c.source,
       c.total_time_minutes,
       c.origin,
       -- Totals and facets belong to the search screen's pagination, which does
       -- not call this. Zeroed rather than computed: an honest zero is cheaper
       -- than a number nothing reads.
       0 as total_recipes,
       0 as total_suggestions,
       '{}'::jsonb as facets,
       0 as pantry_have,
       0 as pantry_missing,
       '[]'::jsonb as pantry_missing_ingredients
from combined c
-- A real recipe beats a suggestion (it can be opened rather than generated),
-- then the most-liked, then oldest-stable by id so paging is deterministic.
order by (c.source = 'recipe') desc, c.favourite_count desc, c.id
limit greatest(p_limit, 0);
$function$

;

CREATE OR REPLACE FUNCTION public.pairing_candidates_for_recipe(p_recipe_id uuid, p_course_types text[], p_per_course integer DEFAULT 6, p_blacklist uuid[] DEFAULT '{}'::uuid[], p_dietary text[] DEFAULT '{}'::text[], p_difficulty text DEFAULT NULL::text, p_include jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(course_type text, source text, pair_rank integer, dish_key uuid, is_recipe boolean, dish_id uuid, name text, name_en text, description text, short_description text, difficulty text, total_time_minutes integer, image text, ingredients jsonb, tags jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with wanted as (select distinct lower(btrim(c)) as course_type
                from unnest(coalesce(p_course_types, '{}'::text[])) c
                where btrim(c) <> ''),

     -- The dish being composed around, normalised the same way every other menu
     -- read normalises it.
     target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key),

     -- Layer 1. Asked for GENEROUSLY and cut per course at the very end,
     -- because the two layers are deduped against each other in between — a
     -- dish that is both evidence and a proposal must take a slot once, as
     -- evidence.
     --
     -- The `+ 2` is the same slack `fetchMenuPairings` asks for in compose and
     -- for the same reason: this inner cut happens per course, BEFORE the
     -- cross-course dedup drops a dish that appears in two of them. Cut to
     -- exactly `p_per_course` here and a course can come back short of dishes
     -- the corpus was holding — which the reader would see as a thin pairing
     -- layer rather than as a cut, and which the floor in the picker would then
     -- apologise for.
     evidence as (select mp.course_type,
                         'menu'::text as source,
                         mp.pair_rank,
                         mp.dish_key,
                         mp.is_recipe,
                         mp.dish_id,
                         mp.name,
                         mp.name_en,
                         mp.description,
                         mp.short_description,
                         mp.difficulty,
                         mp.total_time_minutes,
                         mp.image,
                         mp.ingredients,
                         mp.tags
                  from menu_pairings_for_recipe(
                               p_recipe_id,
                               array(select course_type from wanted),
                               greatest(p_per_course, 1) + 2,
                               '{}'::text[],
                               '{}'::uuid[],
                               coalesce(p_blacklist, '{}'::uuid[]),
                               coalesce(p_dietary, '{}'::text[]),
                               p_difficulty
                       ) mp),

     -- Layer 2. Resolved exactly as `menu_pairings_for_recipe` resolves a
     -- course key: a recipe in the shared catalogue if the dish has been
     -- promoted, otherwise the suggestion row. `b.created_by is null` keeps a
     -- private import out of everybody's proposals.
     proposal_key as (select dp.course_type,
                             dp.dish_key as course_key,
                             dp.rank
                      from dish_pairings dp
                               join wanted w on w.course_type = lower(btrim(dp.course_type))
                               cross join target t
                      where dp.main_dish_key = t.dish_key
                        and dp.dish_key <> t.dish_key),

     proposal_dish as (select k.course_type,
                              k.course_key,
                              k.rank,
                              fam.id                   as recipe_id,
                              fam.source_suggestion_id as recipe_dish_key,
                              s.id                     as suggestion_id
                       from proposal_key k
                                left join lateral (
                           select b.id, b.source_suggestion_id
                           from recipes r
                                    join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                           where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                             and b.created_by is null
                           order by (r.id = k.course_key) desc, b.id
                           limit 1) fam on true
                                left join recipe_suggestions s
                                          on fam.id is null and s.id = k.course_key),

     proposal as (select d.course_type,
                         'proposed'::text                                         as source,
                         d.rank                                                   as pair_rank,
                         coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                         (d.recipe_id is not null)                                as is_recipe,
                         coalesce(d.recipe_id, d.suggestion_id)                   as dish_id,
                         coalesce(r.name, s.name)                                 as name,
                         coalesce(r.name_en, s.name_en)                           as name_en,
                         coalesce(r.description, s.description, '')               as description,
                         r.short_description,
                         coalesce(r.difficulty, s.difficulty)::text               as difficulty,
                         coalesce(r.total_time_minutes, s.total_time_minutes)     as total_time_minutes,
                         r.image
                  from proposal_dish d
                           left join recipes r on r.id = d.recipe_id
                           left join recipe_suggestions s on s.id = d.suggestion_id
                  where coalesce(d.recipe_id, d.suggestion_id) is not null
                    -- The read-time half of the "constraints filter, they do not
                    -- generate" rule. A shared set is written without knowing
                    -- who will read it, so this is the only place the reader's
                    -- own diet can be honoured.
                    and dish_meets_constraints(
                            coalesce(d.recipe_id, d.suggestion_id),
                            d.recipe_id is not null,
                            coalesce(p_blacklist, '{}'::uuid[]),
                            coalesce(p_dietary, '{}'::text[]))),

     -- The reader's own picks, resolved exactly as a proposal is.
     include_key as (select lower(btrim(e.course_type)) as course_type,
                            e.dish_id                   as course_key
                     from jsonb_to_recordset(coalesce(p_include, '[]'::jsonb))
                              as e(course_type text, dish_id uuid)
                              join wanted w on w.course_type = lower(btrim(e.course_type))
                              cross join target t
                     where e.dish_id is not null
                       and e.dish_id <> t.dish_key),

     include_dish as (select k.course_type,
                             k.course_key,
                             fam.id                   as recipe_id,
                             fam.source_suggestion_id as recipe_dish_key,
                             s.id                     as suggestion_id
                      from include_key k
                               left join lateral (
                          select b.id, b.source_suggestion_id
                          from recipes r
                                   join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                          where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                            and b.created_by is null
                          order by (r.id = k.course_key) desc, b.id
                          limit 1) fam on true
                               left join recipe_suggestions s
                                         on fam.id is null and s.id = k.course_key),

     -- NOT filtered by `dish_meets_constraints`, unlike a proposal, and that is
     -- deliberate: the reader picked this dish. The picker's search already
     -- applies their blacklist, so one reaching here is one they chose in full
     -- knowledge — and dropping it would substitute a dish they did not choose,
     -- which is the failure the parameter exists to end rather than a filter to
     -- enforce.
     included as (select d.course_type,
                         'chosen'::text                                           as source,
                         0                                                        as pair_rank,
                         coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                         (d.recipe_id is not null)                                as is_recipe,
                         coalesce(d.recipe_id, d.suggestion_id)                   as dish_id,
                         coalesce(r.name, s.name)                                 as name,
                         coalesce(r.name_en, s.name_en)                           as name_en,
                         coalesce(r.description, s.description, '')               as description,
                         r.short_description,
                         coalesce(r.difficulty, s.difficulty)::text               as difficulty,
                         coalesce(r.total_time_minutes, s.total_time_minutes)     as total_time_minutes,
                         r.image
                  from include_dish d
                           left join recipes r on r.id = d.recipe_id
                           left join recipe_suggestions s on s.id = d.suggestion_id
                  where coalesce(d.recipe_id, d.suggestion_id) is not null),

     merged as (select * from evidence
                union all
                select p.course_type,
                       p.source,
                       p.pair_rank,
                       p.dish_key,
                       p.is_recipe,
                       p.dish_id,
                       p.name,
                       p.name_en,
                       p.description,
                       p.short_description,
                       p.difficulty,
                       p.total_time_minutes,
                       p.image,
                       -- A CASE rather than two subqueries concatenated:
                       -- `jsonb_agg` over no rows is NULL, and NULL || x is
                       -- NULL, so the obvious union of the two halves empties
                       -- the card of whichever kind of dish this is.
                       case
                           when p.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                                              from recipe_ingredients ri
                                                       join ingredients i on i.id = ri.ingredient_id
                                              where ri.recipe_id = p.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                                          from recipe_suggestion_ingredients rsi
                                                   join ingredients i on i.id = rsi.ingredient_id
                                          where rsi.recipe_suggestion_id = p.dish_id), '[]'::jsonb)
                           end,
                       case
                           when p.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = p.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                          from recipe_suggestion_tags rst
                                                   join tags t on t.id = rst.tag_id
                                          where rst.recipe_suggestion_id = p.dish_id), '[]'::jsonb)
                           end
                from proposal p
                union all
                select i.course_type,
                       i.source,
                       i.pair_rank,
                       i.dish_key,
                       i.is_recipe,
                       i.dish_id,
                       i.name,
                       i.name_en,
                       i.description,
                       i.short_description,
                       i.difficulty,
                       i.total_time_minutes,
                       i.image,
                       case
                           when i.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', ing.id, 'name', ing.name))
                                              from recipe_ingredients ri
                                                       join ingredients ing on ing.id = ri.ingredient_id
                                              where ri.recipe_id = i.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', ing.id, 'name', ing.name))
                                          from recipe_suggestion_ingredients rsi
                                                   join ingredients ing on ing.id = rsi.ingredient_id
                                          where rsi.recipe_suggestion_id = i.dish_id), '[]'::jsonb)
                           end,
                       case
                           when i.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = i.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                          from recipe_suggestion_tags rst
                                                   join tags t on t.id = rst.tag_id
                                          where rst.recipe_suggestion_id = i.dish_id), '[]'::jsonb)
                           end
                from included i),

     -- How much each layer is worth, as one number the two orderings below
     -- share. A boolean `source = 'menu'` did this while there were two layers
     -- and cannot express three — and the reader's own pick has to outrank both
     -- of the others, or the per-course cut can drop the one dish they chose.
     weighted as (select m.*,
                         case m.source
                             when 'chosen' then 0
                             when 'menu' then 1
                             else 2
                             end as source_rank
                  from merged m),

     -- One row per dish, the most authoritative layer winning a tie. `distinct
     -- on` over the dish key rather than a `group by`, so a dish that is both
     -- evidence and a proposal keeps its evidence ranking rather than appearing
     -- twice — and one the reader chose keeps its place whatever else it is.
     deduped as (select distinct on (w.dish_key) w.*
                 from weighted w
                 order by w.dish_key,
                          w.source_rank,
                          w.pair_rank),

     ranked as (select d.*,
                       row_number() over (
                           partition by d.course_type
                           order by d.source_rank,
                                    d.pair_rank,
                                    difficulty_preference_rank(d.difficulty, p_difficulty),
                                    d.name
                           ) as slot_rank
                from deduped d)

select rk.course_type,
       rk.source,
       rk.slot_rank::integer,
       rk.dish_key,
       rk.is_recipe,
       rk.dish_id,
       rk.name,
       rk.name_en,
       coalesce(rk.description, ''),
       rk.short_description,
       rk.difficulty,
       rk.total_time_minutes,
       rk.image,
       coalesce(rk.ingredients, '[]'::jsonb),
       coalesce(rk.tags, '[]'::jsonb)
from ranked rk
where rk.slot_rank <= greatest(p_per_course, 1)
  -- THE EDIT (20260922000001). Applied once, at the end, rather than in
  -- each of the six laterals above: SECURITY DEFINER means no policy
  -- runs, and this is the one place every candidate has already been
  -- reduced to (dish_id, is_recipe). It costs two indexed lookups over a
  -- handful of rows.
  and not exists (select 1
                  from recipes hr
                  where rk.is_recipe
                    and hr.id = rk.dish_id
                    and hr.hidden_at is not null)
  and not exists (select 1
                  from recipe_suggestions hs
                  where not rk.is_recipe
                    and hs.id = rk.dish_id
                    and hs.hidden_at is not null);
$function$

;

------------------------------------------------------------------------------
-- 5. Retire the one-argument rule
------------------------------------------------------------------------------
--
-- Last, and it is the assertion this migration rests on: Postgres refuses to
-- drop a function anything still depends on, so if a policy or a body above
-- was missed, THIS LINE FAILS and the migration rolls back. Leaving the old
-- signature in place as an overload would mean a missed call site compiles,
-- runs, and quietly shows hidden dishes.
------------------------------------------------------------------------------

drop function public.recipe_is_visible(uuid);
