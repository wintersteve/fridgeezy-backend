-- A view history is the newest 50 dishes, and nothing older.
--
-- `profile_recipe_interactions` holds one row per (profile, recipe, type) and
-- the client UPSERTS `viewed` on every recipe open, bumping `created_at`. So
-- the `viewed` half grows with every DISTINCT dish an account has ever looked
-- at, forever, and nothing has ever removed a row. That is the one table in the
-- schema that accumulates purely as a side effect of reading.
--
-- The same shape as `record_prompt`'s 200 and `prune_profile_chat_conversations`'
-- 60, and for the same two reasons. It is a product statement — how far back a
-- "recipes you looked at and did not keep" list is worth scrolling — rather
-- than a number fitted to anything, and it is data minimisation: a permanent
-- record of every dish a person has ever opened is, after the prompts, the most
-- personal thing here, and the prompts are pruned.
--
-- Nothing reads the deep history. Audited before writing this: no API code
-- touches the table at all, and the only SQL that does is the merge repoint in
-- `merge_recipe` and the guard named below. On the client, three surfaces read
-- `viewed` — the picker's shortlist (newest twenty), `EmptyLibraryCard` (is it
-- zero), and `/recently-viewed`, which pages and is the only one that could see
-- past 50.
--
-- ## The one coupling, and it is not obvious
--
-- `delete_orphan_generated_recipes` keeps a generated recipe alive while ANY
-- `profile_recipe_interactions` row points at it, `viewed` included — so
-- pruning a view removes protection from a generated dish that nothing else
-- references, and after 30 days that sweep may delete it.
--
-- That is latent today: the sweep has been defined and deliberately UNSCHEDULED
-- since `20260801000015`, and stays that way until `is_generated` separates
-- drafts from catalogue entries and image cleanup is handled. It is written
-- down here because the two become live on the same day: when the sweep is
-- scheduled, a dish somebody merely glanced at 51 dishes ago stops being
-- protected by the glance. That is the sweep's own intent — it deletes
-- generated recipes the cook never kept — but it is a consequence to have
-- chosen rather than to discover.
--
-- ## What is NOT pruned
--
-- `favourite` and `cooked`. A heart is the reader's own kept data and the list
-- it fills has no ceiling; `cooked` is a record. Only the type written without
-- anyone asking for it is capped.

create or replace function public.prune_viewed_recipe_interactions()
    returns trigger
    language plpgsql
as
$function$
declare
    -- How many dishes a view history keeps. See the header: a product
    -- statement, the exception `record_prompt`'s 200 and the chat drawer's 60
    -- already occupy.
    v_limit constant integer := 50;
begin
    delete
    from profile_recipe_interactions i
    where i.profile_id = new.profile_id
      and i.interaction_type = 'viewed'
      and i.id not in (select keep.id
                       from profile_recipe_interactions keep
                       where keep.profile_id = new.profile_id
                         and keep.interaction_type = 'viewed'
                       -- `id` breaks a tie, so two views written in the same
                       -- microsecond cannot both be "the oldest" and leave the
                       -- delete non-deterministic.
                       order by keep.created_at desc, keep.id desc
                       limit v_limit);

    return null;
end;
$function$;

comment on function public.prune_viewed_recipe_interactions() is
    'Keeps the newest 50 viewed interactions per profile. AFTER INSERT on viewed rows only: a re-view is an UPDATE of created_at, which cannot raise the count, and favourite/cooked rows are never pruned.';

drop trigger if exists prune_viewed_interactions on profile_recipe_interactions;
create trigger prune_viewed_interactions
    after insert
    on profile_recipe_interactions
    for each row
    -- In the trigger rather than in the function: a favourite is by far the
    -- commonest insert here, and this way it does not enter the function at all.
    when (new.interaction_type = 'viewed')
execute function public.prune_viewed_recipe_interactions();

-- The existing rows, once. Without it the cap would only reach a profile on its
-- next recipe open — true of nearly everybody eventually, and not of an account
-- that has stopped being used, which is exactly the history worth not keeping.
delete
from profile_recipe_interactions i
where i.interaction_type = 'viewed'
  and i.id not in (select keep.id
                   from (select k.id,
                                row_number() over (partition by k.profile_id
                                    order by k.created_at desc, k.id desc) as rank
                         from profile_recipe_interactions k
                         where k.interaction_type = 'viewed') keep
                   where keep.rank <= 50);

notify pgrst, 'reload schema';
