-- A durable record of human verdicts on ingredient pairs, plus the two repairs
-- `20260823000003` made necessary.
--
-- WHY THIS TABLE EXISTS. The identity check surfaces contradictions — the alias
-- table says two names are one thing while two ingredient rows say otherwise —
-- and roughly a third of them are genuinely ambiguous ("Whipping Cream" vs
-- "Heavy Cream"), so a person has to decide. Without somewhere to put that
-- decision the nightly check re-raises the same pair forever, people learn to
-- skim past it, and the one row that matters is buried under eleven that do
-- not. A review queue nobody trusts is worse than no queue, because it reads as
-- coverage.
--
-- The load-bearing property is therefore that a **`distinct` verdict is
-- STICKY**: once someone says "these are two ingredients", every later report
-- must stay quiet about that pair.

create table if not exists ingredient_merge_reviews
(
    id           uuid primary key                  default gen_random_uuid(),
    ingredient_a uuid                     not null references ingredients (id) on delete cascade,
    ingredient_b uuid                     not null references ingredients (id) on delete cascade,
    -- 'pending'  — surfaced, nobody has decided
    -- 'distinct' — a person ruled these are two ingredients. Suppresses forever.
    -- 'merged'   — a person ruled they are one. Normally short-lived: the merge
    --              deletes a row and CASCADE takes this with it.
    status       text                     not null default 'pending'
        constraint ingredient_merge_reviews_status_check
            check (status in ('pending', 'distinct', 'merged')),
    -- Why the pair was surfaced: {source, cosine, relation, via_alias}.
    evidence     jsonb                    not null default '{}'::jsonb,
    note         text,
    decided_at   timestamp with time zone,
    created_at   timestamp with time zone not null default now(),

    -- An unordered pair stored in one canonical order, so (a,b) and (b,a) cannot
    -- both exist and a verdict cannot be evaded by asking the question backwards.
    constraint ingredient_merge_reviews_ordered check (ingredient_a < ingredient_b),
    constraint ingredient_merge_reviews_pair_key unique (ingredient_a, ingredient_b),
    -- A decided row must say when. Keeps 'pending' and 'decided' from blurring.
    constraint ingredient_merge_reviews_decided_check check (
        (status = 'pending' and decided_at is null)
            or (status <> 'pending' and decided_at is not null)
        )
);

create index if not exists idx_ingredient_merge_reviews_status
    on ingredient_merge_reviews using btree (status);

alter table ingredient_merge_reviews enable row level security;
-- Catalogue maintenance, not user data: readable, never client-writable. Every
-- write goes through `record_merge_review` under the service role.
create policy public_read on ingredient_merge_reviews for select using (true);

-- Note the FK is to `ingredients.id` with CASCADE rather than to the canonical
-- id text. A verdict only has to outlive the REPORT, not the rows: a 'distinct'
-- verdict exists precisely because both rows survive, so it survives with them,
-- and a 'merged' verdict becomes meaningless the moment the merge deletes a
-- side. Keying on text would leave verdicts about ingredients nobody can name.

/**
 * Record a verdict, normalising the pair order so callers do not have to.
 * Re-deciding an existing pair overwrites it; that is how a mistaken 'distinct'
 * gets undone.
 */
create or replace function public.record_merge_review(
    p_a uuid,
    p_b uuid,
    p_status text default 'pending',
    p_evidence jsonb default '{}'::jsonb,
    p_note text default null
)
    returns uuid
    language plpgsql
as $function$
declare
    v_lo uuid;
    v_hi uuid;
    v_id uuid;
begin
    if p_a is null or p_b is null or p_a = p_b then
        raise exception 'record_merge_review: needs two distinct ingredients';
    end if;

    v_lo := least(p_a, p_b);
    v_hi := greatest(p_a, p_b);

    insert into ingredient_merge_reviews (ingredient_a, ingredient_b, status, evidence, note,
                                          decided_at)
    values (v_lo, v_hi, p_status, p_evidence, p_note,
            case when p_status = 'pending' then null else now() end)
    on conflict (ingredient_a, ingredient_b)
        do update set status     = excluded.status,
                      evidence   = excluded.evidence,
                      note       = coalesce(excluded.note, ingredient_merge_reviews.note),
                      decided_at = excluded.decided_at
    returning id into v_id;

    return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The collisions view, now filtered by verdict.
--
-- This is the wiring that makes a resolved contradiction stay resolved: a pair
-- ruled `distinct` drops out of the report, and out of anything driven by it.
-- `_all` keeps the unfiltered set available, because "what did we decide and
-- why" is a different question from "what is outstanding".
-- ---------------------------------------------------------------------------

create or replace view ingredient_alias_collisions_all as
select i.id           as duplicate_id,
       i.name         as duplicate_name,
       t.id           as keep_id,
       t.name         as keep_name,
       a.alias        as via_alias,
       (select count(*) from recipe_ingredients r where r.ingredient_id = i.id)
           + (select count(*) from recipe_suggestion_ingredients s where s.ingredient_id = i.id)
                      as duplicate_uses,
       coalesce(rev.status, 'pending') as review_status
from ingredients i
         join ingredient_aliases a on a.alias_canonical_id = i.canonical_id
         join ingredients t on t.id = a.ingredient_id and t.id <> i.id
         left join ingredient_merge_reviews rev
                   on rev.ingredient_a = least(i.id, t.id)
                       and rev.ingredient_b = greatest(i.id, t.id);

create or replace view ingredient_alias_collisions as
select duplicate_id, duplicate_name, keep_id, keep_name, via_alias, duplicate_uses
from ingredient_alias_collisions_all
where review_status <> 'distinct';

comment on view ingredient_alias_collisions is
    'Outstanding contradictions: an ingredient row whose canonical id is already '
        'claimed by an alias pointing elsewhere. Pairs ruled `distinct` in '
        'ingredient_merge_reviews are suppressed — see ingredient_alias_collisions_all '
        'for the unfiltered set. Should reach zero after cleanup; non-empty '
        'afterwards means a write path is bypassing alias resolution.';

-- ---------------------------------------------------------------------------
-- Repair: `merge_ingredient` is broken by the canonical alias index.
--
-- `20260823000003` added `ingredient_aliases_canonical_key`, and merge_ingredient
-- guards its alias writes against the OLD literal `alias` constraint only:
--
--   insert into ingredient_aliases (...) ... on conflict (alias) do nothing
--
-- Merging "Green Onion" into "Scallion" inserts the alias 'Green Onion', whose
-- canonical is `green_onion` — already present as 'green onion'. Different
-- literals, so `on conflict (alias)` does not fire, and the canonical index
-- raises. That is not a corner case: it is EXACTLY the merge the cleanup exists
-- to perform, so without this every alias-collision merge would abort.
--
-- Both alias writes are fixed, and both now reason in canonical terms.
-- ---------------------------------------------------------------------------

create or replace function public.merge_ingredient(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- recipe_ingredients: repoint, skipping rows that would collide with an
    -- existing (recipe_id, p_into) pair, then drop the leftover from-rows.
    --
    -- Note the loss this implies and does not report: a recipe holding BOTH
    -- ingredients keeps the p_into row and DISCARDS p_from's quantity, unit and
    -- comment. Quantities are not summed — "200g flour + 100g all-purpose flour"
    -- becomes "200g flour". Callers should count these first; the cleanup
    -- operation prints them.
    update recipe_ingredients ri
       set ingredient_id = p_into
     where ri.ingredient_id = p_from
       and not exists (
           select 1 from recipe_ingredients ri2
            where ri2.recipe_id = ri.recipe_id
              and ri2.ingredient_id = p_into
       );
    delete from recipe_ingredients where ingredient_id = p_from;

    -- recipe_suggestion_ingredients: same conflict-safe repoint.
    update recipe_suggestion_ingredients rsi
       set ingredient_id = p_into
     where rsi.ingredient_id = p_from
       and not exists (
           select 1 from recipe_suggestion_ingredients rsi2
            where rsi2.recipe_suggestion_id = rsi.recipe_suggestion_id
              and rsi2.ingredient_id = p_into
       );
    delete from recipe_suggestion_ingredients where ingredient_id = p_from;

    -- profile_blacklisted_ingredients: repoint, conflict-safe on
    -- (profile_id, ingredient_id).
    --
    -- THIS WAS MISSING, and it is the most dangerous omission in the original
    -- function. The FK is ON DELETE CASCADE, so the final `delete from
    -- ingredients` silently DESTROYED every blacklist row pointing at the
    -- merged-away ingredient. Someone who told the app they cannot eat peanuts
    -- would simply stop having said it — no error, nothing to notice, and the
    -- next promote would happily serve them the thing.
    --
    -- The catalogue happens to hold zero blacklist rows today, which is why
    -- nothing has broken; that is timing, not safety. Every other reference in
    -- this function is repointed before the delete, and this one has to be too.
    update profile_blacklisted_ingredients b
       set ingredient_id = p_into
     where b.ingredient_id = p_from
       and not exists (
           select 1 from profile_blacklisted_ingredients b2
            where b2.profile_id = b.profile_id
              and b2.ingredient_id = p_into
       );
    -- Anything left is a profile that already blacklists p_into, so the
    -- restriction survives on the row we keep.
    delete from profile_blacklisted_ingredients where ingredient_id = p_from;

    -- Self-reference: children whose parent was p_from now point at p_into.
    update ingredients set parent_id = p_into where parent_id = p_from;

    -- recipe_instructions.ingredient_refs: replace p_from with p_into inside the
    -- UUID[] id array (de-duped; order is not significant for ingredient refs).
    update recipe_instructions
       set ingredient_refs = (
           select array_agg(distinct
               case when elem = p_from then p_into else elem end)
             from unnest(ingredient_refs) as elem
       )
     where p_from = any (ingredient_refs);

    -- ingredient_aliases: move p_from's aliases to p_into, skipping any whose
    -- CANONICAL form is already claimed — by p_into or by anybody else, since
    -- the canonical index is global. Then drop what could not move.
    update ingredient_aliases a
       set ingredient_id = p_into
     where a.ingredient_id = p_from
       and not exists (
           select 1 from ingredient_aliases a2
            where a2.alias_canonical_id = a.alias_canonical_id
              and a2.id <> a.id
       );
    delete from ingredient_aliases where ingredient_id = p_from;

    -- Record p_from's own name as an alias of p_into, so the merged-away name
    -- still resolves. Guarded on the canonical key rather than the literal one.
    insert into ingredient_aliases (ingredient_id, alias)
        select p_into, i.name from ingredients i where i.id = p_from
        on conflict (alias_canonical_id) do nothing;

    -- Rescue curated metadata before the row goes.
    --
    -- merge_ingredient historically moved REFERENCES and destroyed CONTENT: the
    -- descriptive columns live only on the row being deleted. Measured on the
    -- live catalogue, the pending cleanup would have destroyed a description on
    -- 3 merges and `nutritional_info` on 7 — including Chicken Egg, Whole Milk
    -- and All Purpose Flour, whose surviving rows carry none. That is seeded,
    -- hand-written catalogue content, and nothing would have reported its loss.
    --
    -- Strictly a NULL-fill: `coalesce(keep, dup)` never overwrites a value the
    -- surviving row already has, so the winner's own data always takes
    -- precedence and this cannot silently rewrite an ingredient's description.
    update ingredients k
       set description      = coalesce(k.description, d.description),
           nutritional_info = coalesce(k.nutritional_info, d.nutritional_info),
           storage_tips     = coalesce(k.storage_tips, d.storage_tips),
           shelf_life       = coalesce(k.shelf_life, d.shelf_life),
           image_url        = coalesce(k.image_url, d.image_url),
           category_id      = coalesce(k.category_id, d.category_id)
      from ingredients d
     where k.id = p_into
       and d.id = p_from;

    -- Remove the merged-away ingredient.
    delete from ingredients where id = p_from;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Batch merge: the whole cleanup as ONE transaction.
--
-- Calling `merge_ingredient` N times over PostgREST is N transactions, so a
-- failure on merge 27 of 40 leaves the catalogue in a state nobody designed:
-- some names collapsed, some not, and no record of where it stopped. A plpgsql
-- function is a single transaction, so an exception anywhere rolls the entire
-- cleanup back and the database is exactly as it was.
--
-- That is the ONLY reversibility this operation has. `merge_ingredient` deletes
-- rows; once this commits, going back means restoring from a backup. Take one.
-- ---------------------------------------------------------------------------
create or replace function public.merge_ingredients_batch(p_pairs jsonb)
    returns jsonb
    language plpgsql
as $function$
declare
    v_pair          jsonb;
    v_from          uuid;
    v_into          uuid;
    v_merged        int := 0;
    v_skipped       int := 0;
    v_edges_before  int;
    v_edges_after   int;
begin
    select count(*) into v_edges_before from recipe_ingredients;

    for v_pair in select * from jsonb_array_elements(p_pairs)
        loop
            v_from := (v_pair ->> 'from')::uuid;
            v_into := (v_pair ->> 'into')::uuid;

            -- A pair whose sides have already been collapsed by an earlier merge
            -- in this same batch is a no-op, not an error.
            if not exists (select 1 from ingredients where id = v_from)
                or not exists (select 1 from ingredients where id = v_into) then
                v_skipped := v_skipped + 1;
                continue;
            end if;

            -- Refuse anything under review that has not been ruled MERGED.
            --
            -- Not just 'distinct': a PENDING pair must be held back too, or the
            -- queue is decorative. The backfill seeds sibling contradictions as
            -- pending precisely because a person has to decide them, and a
            -- cleanup that merges them anyway answers the question it was
            -- supposed to be asking. Measured before this guard existed, the
            -- plan silently included Whipping Cream -> Heavy Cream and
            -- Risotto Rice -> Arborio Rice, both queued for review.
            --
            -- So the rule is allow-listed rather than deny-listed: merge when
            -- there is NO review row, or when someone has explicitly said
            -- 'merged'. Anything else waits.
            if exists (select 1
                       from ingredient_merge_reviews
                       where ingredient_a = least(v_from, v_into)
                         and ingredient_b = greatest(v_from, v_into)
                         and status <> 'merged') then
                v_skipped := v_skipped + 1;
                continue;
            end if;

            perform merge_ingredient(v_from, v_into);
            v_merged := v_merged + 1;
        end loop;

    select count(*) into v_edges_after from recipe_ingredients;

    return jsonb_build_object(
        'merged', v_merged,
        'skipped', v_skipped,
        'recipe_ingredient_rows_before', v_edges_before,
        'recipe_ingredient_rows_after', v_edges_after,
        'recipe_ingredient_rows_lost', v_edges_before - v_edges_after
    );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Backfill: seed every outstanding contradiction as `pending`.
--
-- Only the SIBLING-shaped ones. A contradiction whose two names are structurally
-- bare-vs-modified or different-headed ("all-purpose flour" vs "Flour") is a
-- duplicate the cleanup merges without asking; queueing those would put 40 rows
-- in front of a person to rubber-stamp and bury the 10 that need thought.
--
-- `on conflict do nothing` via record_merge_review's upsert keeps this
-- idempotent, and re-running it can never overwrite a verdict with 'pending',
-- because a decided pair is filtered out below.
-- ---------------------------------------------------------------------------
do $$
declare
    v_row record;
    v_seeded int := 0;
begin
    for v_row in
        select distinct on (least(c.duplicate_id, c.keep_id), greatest(c.duplicate_id, c.keep_id))
               c.duplicate_id, c.duplicate_name, c.keep_id, c.keep_name, c.via_alias
        from ingredient_alias_collisions_all c
        where c.review_status = 'pending'
          -- sibling-shaped: same head noun, both sides modified. Mirrors
          -- `ingredientRelation` in @fridgeezy/toolkit — the rule has to be the
          -- same one the resolver uses or the queue describes a different world.
          and (
            (string_to_array(
                 (select canonical_id from ingredients where id = c.duplicate_id), '_')
             )[array_length(string_to_array(
                 (select canonical_id from ingredients where id = c.duplicate_id), '_'), 1)]
            =
            (string_to_array(
                 (select canonical_id from ingredients where id = c.keep_id), '_')
             )[array_length(string_to_array(
                 (select canonical_id from ingredients where id = c.keep_id), '_'), 1)]
            )
          and array_length(string_to_array(
                (select canonical_id from ingredients where id = c.duplicate_id), '_'), 1) > 1
          and array_length(string_to_array(
                (select canonical_id from ingredients where id = c.keep_id), '_'), 1) > 1
        loop
            perform record_merge_review(
                v_row.duplicate_id,
                v_row.keep_id,
                'pending',
                jsonb_build_object(
                    'source', 'alias_collision_backfill',
                    'via_alias', v_row.via_alias,
                    'relation', 'sibling',
                    'names', jsonb_build_array(v_row.duplicate_name, v_row.keep_name)
                ),
                null
            );
            v_seeded := v_seeded + 1;
        end loop;

    raise notice 'ingredient_merge_reviews: seeded % pending sibling contradiction(s)', v_seeded;
end;
$$;
