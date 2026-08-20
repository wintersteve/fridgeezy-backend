------------------------------------------------------------------------------
-- profile_prompts: what this cook actually typed
------------------------------------------------------------------------------
--
-- Every free-text prompt in this app has, until now, lived on ONE PHONE. The
-- client's `CHAT_HISTORY_STORE` (zustand + AsyncStorage) holds the chat
-- transcripts, the modify instruction travels in a route query string and a
-- background-job id, and cook-mode questions are plain `useState`. None of it
-- survives a reinstall, none of it follows the cook to a second device, and the
-- server — which sees every one of these strings on its way to a model — wrote
-- none of them down.
--
-- This is the log. `POST /chat`, `POST /recipes/:id/chat` and
-- `POST /recipes/modify` are the three routes that carry user-authored prose,
-- and each records its turn here as it passes.
--
-- ## An EVENT LOG, deliberately — the opposite of profile_taste_signals
--
-- `20260815000007` stores one counted row per (profile, kind, value) and says
-- why at length: a signal is only worth acting on when it REPEATS, so an event
-- log would be the wrong shape there. This table is the wrong shape for THAT
-- and the right shape for this. History is answering "what did I ask, and
-- when" — a question a collapsed row with an occurrence count cannot answer at
-- all, because the thing the user wants back is the exact sentence and the
-- moment it belongs to.
--
-- The two are complements, not duplicates, and both are written from the same
-- call sites: `record_taste_signal` gets the canonicalised LABEL ("vegetarian")
-- and this gets the RAW PROMPT ("can you make this one vegetarian for Ana?").
-- Neither can be derived from the other.
--
-- ## Recipe-scoped prompts carry the recipe
--
-- `recipe_id` is what separates "make it spicier" typed at a dish from the same
-- words typed into the general assistant. Without it a history list can show
-- the sentence and nothing else — no dish name to render beside it and nowhere
-- to navigate on tap, which is most of what a history entry is for.
--
-- **ON DELETE CASCADE, and the alternative was considered.** `set null` would
-- keep the sentence and lose the dish, leaving a row that renders as an
-- unopenable orphan. Recipes that actually get deleted are unsaved generated
-- ones (`delete_orphan_generated_recipes`), i.e. dishes the cook never kept, so
-- cascading drops history for things they walked away from and keeps everything
-- attached to a recipe they still have. The cost is real and is accepted: a
-- swept recipe takes its prompts with it, silently.
--
-- ## Bounded by construction
--
-- `record_prompt` prunes to the newest 200 rows per profile on every insert.
-- The client's AsyncStorage store it replaces has no cap at all and
-- re-serialises the whole array on every turn; moving that unbounded growth
-- server-side unchanged would only relocate the problem. A cap in the writer
-- rather than a scheduled reaper because there is no scheduler here —
-- `delete_orphan_generated_recipes` has been defined and unscheduled since the
-- baseline, and a retention rule nothing runs is not a retention rule.
--
-- The cap is per PROFILE, not per surface and not per recipe, and the
-- consequence is worth stating because it is invisible from the screen it
-- affects: a cook who chats heavily can push their own recipe-scoped prompts
-- out, so a recipe screen's "what have I asked about this dish" can empty
-- without the dish or its prompts being touched. That is accepted. "The last
-- 200 things you typed" is a rule a person can hold in their head; per-surface
-- quotas are three rules that interact, and the failure they prevent is a
-- history list being shorter than it could have been.

create table if not exists profile_prompts
(
    id              uuid primary key                  default gen_random_uuid(),
    profile_id      uuid                     not null references profiles (id) on delete cascade,
    -- The dish this prompt was typed at, for the two recipe-scoped surfaces.
    -- NULL for `chat`, which is not about any one recipe. See the cascade note
    -- in the header.
    recipe_id       uuid references recipes (id) on delete cascade,
    -- Text + check rather than an enum, following `recipes.origin` and
    -- `profile_taste_signals.kind`: widening a check constraint is one
    -- migration, widening an enum is `alter type` and cannot be done inside a
    -- transaction with other DDL on some versions.
    --
    -- Mirrored in TypeScript as `PromptSurface`; the constraint is the one that
    -- actually holds, so a value added there without a migration fails at the
    -- insert rather than at compile time.
    surface         text                     not null,
    -- The prompt AS TYPED. Not canonicalised, not truncated to a label — that
    -- is what `profile_taste_signals.value` is, and the whole point of this
    -- column is to be the thing canonicalisation throws away.
    prompt          text                     not null,
    -- Groups the turns of one conversation, so a history list can show threads
    -- rather than loose sentences. Client-generated and opaque here: the server
    -- never starts a conversation, it only ever sees a turn of one.
    --
    -- Nullable because `recipe_modify` is a single shot with no thread, and a
    -- chat turn from a client that does not track threads is still worth
    -- keeping.
    conversation_id uuid,
    -- `clock_timestamp()`, NOT the `now()` every other table here defaults to,
    -- and the deviation is the point. `now()` is TRANSACTION time, so rows
    -- written in one transaction share a timestamp to the microsecond. Every
    -- other table tolerates that because nothing orders on it; this one is an
    -- append-only log whose entire read pattern is "newest first" and whose
    -- retention rule DELETES by that order. Under `now()` a batch writer — a
    -- history import, a backfill, the `do` loop that first caught this — hands
    -- the prune a block of ties to break on a random v4 uuid, and it evicts an
    -- arbitrary subset instead of the oldest. Measured: 250 rows inserted in
    -- one transaction, newest survivor `prompt number 113`.
    --
    -- Production writes one row per request, so this is not a live bug today.
    -- It is a guarantee made true by construction rather than by every future
    -- writer happening to use its own transaction.
    created_at      timestamp with time zone not null default clock_timestamp(),

    constraint profile_prompts_surface_check
        check (surface in ('chat', 'recipe_chat', 'recipe_modify')),
    -- Non-empty after trimming, and capped. `record_prompt` already trims and
    -- truncates to this length, so this constrains the direct service-role
    -- insert path too rather than trusting every future writer to remember.
    constraint profile_prompts_prompt_check
        check (char_length(btrim(prompt)) between 1 and 2000),
    -- A recipe-scoped surface without its recipe is the one shape that cannot
    -- be rendered, and the one a caller forgetting to thread the id through
    -- would produce. Made impossible here rather than checked at four call
    -- sites — the same construction `recipes`' "imported implies owned" check
    -- uses (20260815000005).
    constraint profile_prompts_recipe_scope_check
        check ((surface = 'chat') = (recipe_id is null))
);

-- The history list: this profile's prompts, newest first. `id` breaks the tie
-- so a cursor over `created_at` is stable when two turns land in the same
-- millisecond, which a fast chat exchange does.
create index if not exists idx_profile_prompts_profile_created
    on profile_prompts using btree (profile_id, created_at desc, id desc);

-- "What have I asked about THIS dish", the recipe screen's own history.
create index if not exists idx_profile_prompts_profile_recipe_created
    on profile_prompts using btree (profile_id, recipe_id, created_at desc)
    where (recipe_id is not null);

-- Replaying one thread.
create index if not exists idx_profile_prompts_conversation
    on profile_prompts using btree (profile_id, conversation_id, created_at)
    where (conversation_id is not null);

comment on table profile_prompts is
    'Free-text prompts as the user typed them, newest-capped per profile. Written only by the API (service role); see record_prompt. Complements profile_taste_signals, which stores the canonicalised label of the same input.';

comment on column profile_prompts.recipe_id is
    'The dish a recipe_chat/recipe_modify prompt was typed at; NULL exactly when surface = ''chat'' (profile_prompts_recipe_scope_check). Cascades: a swept recipe takes its prompts with it.';

comment on column profile_prompts.conversation_id is
    'Client-generated thread key grouping chat turns. Opaque to the server, which only ever sees one turn.';

------------------------------------------------------------------------------
-- RLS: readable and forgettable by the owner, writable by nobody
------------------------------------------------------------------------------
--
-- Select and delete only, exactly mirroring `profile_taste_signals` — and for a
-- sharper version of the same reason. A client that can INSERT here can write
-- prompts into its own history that it never sent, which is not merely untidy:
-- these rows are the record of what a person asked, and a forgeable record is
-- worse than no record. Every real write already has a server hop in front of
-- it, because the API is what holds the text on its way to the model.
--
-- Delete IS granted, and here it is not a nicety. This is verbatim
-- user-authored prose — the most personal column in the schema — so "forget
-- that I asked that" has to be one tap and not a support request. Note the
-- client can therefore do its own reads and deletes straight through PostgREST
-- under these policies, the way it already does for `profile_taste_signals`;
-- the REST endpoints are a second door onto the same rows, not the only one.

alter table profile_prompts enable row level security;

create policy users_read_own_prompts on profile_prompts for select
    using (profile_id = current_profile_id());

create policy users_forget_own_prompts on profile_prompts for delete
    using (profile_id = current_profile_id());

-- Belt and braces, matching `menus` in 20260821000001: with RLS on and no write
-- policy, an INSERT or UPDATE from a client matches zero rows and PostgREST
-- answers **204**, so a stale writer fails SILENTLY. The revoke turns that into
-- a permission error the caller can actually see.
revoke insert, update on profile_prompts from anon, authenticated;

------------------------------------------------------------------------------
-- record_prompt: append, then prune
------------------------------------------------------------------------------
--
-- **SECURITY INVOKER (the default), and that is the gate** — the same reasoning
-- `record_taste_signal` spells out. With no insert policy above, a call from
-- any client role fails RLS and writes nothing; the service role the API holds
-- bypasses RLS and writes. SECURITY DEFINER would hand every authenticated
-- client the ability to forge its own history, routing straight around the
-- missing insert policy that is the whole protection.
--
-- `p_profile_id` is safe as a parameter for the same reason it is safe there:
-- the only caller that gets past RLS is the service role, which resolved the id
-- from a verified token one hop earlier.
--
-- Returns the inserted row rather than void — unlike a taste signal, the client
-- has an id to hold onto here (it is what `DELETE /rest/prompts/:id` takes) and
-- a timestamp to render.

create or replace function public.record_prompt(
    p_profile_id uuid,
    p_surface text,
    p_prompt text,
    p_recipe_id uuid default null,
    p_conversation_id uuid default null
)
    returns profile_prompts
    language plpgsql
as
$function$
declare
    -- How many prompts a profile keeps. Set by hand and there is no
    -- distribution to fit it to — the same exception `TIME_BAND_MAX_MINUTES`
    -- and `TASTE_SIGNAL_MIN_OCCURRENCES` occupy. It is a product statement
    -- about how far back a history list is worth scrolling, chosen so a heavy
    -- user's table stays in the tens of kilobytes.
    v_limit  constant integer := 200;
    -- Trimmed and truncated HERE rather than at the call site, so every writer
    -- gets it: the check constraint above would otherwise reject an
    -- over-long prompt and fail a request whose model call already succeeded.
    v_prompt text := left(btrim(p_prompt), 2000);
    v_row    profile_prompts;
begin
    -- Whitespace is not a prompt. Returns NULL rather than raising: the caller
    -- is a stream handler mid-model-call with nothing useful to do about it.
    if v_prompt = '' then
        return null;
    end if;

    insert into profile_prompts (profile_id, surface, prompt, recipe_id, conversation_id)
    values (p_profile_id, p_surface, v_prompt, p_recipe_id, p_conversation_id)
    returning * into v_row;

    -- Prune to the newest v_limit for THIS profile only. Scoped by the same
    -- index the history list uses, so it is a bounded walk rather than a scan.
    delete
    from profile_prompts p
    where p.profile_id = p_profile_id
      and p.id not in (select keep.id
                       from profile_prompts keep
                       where keep.profile_id = p_profile_id
                       order by keep.created_at desc, keep.id desc
                       limit v_limit);

    return v_row;
end;
$function$;

comment on function public.record_prompt(uuid, text, text, uuid, uuid) is
    'Append one prompt to a profile''s history and prune to the newest 200. SECURITY INVOKER: writable only by the service role, since no insert policy grants it to anyone else.';

revoke all on function public.record_prompt(uuid, text, text, uuid, uuid) from public;

-- Deliberately NOT granted to `authenticated`. Unlike the RPCs in
-- 20260815000004 and `save_menu`, this one is not a client entry point — the
-- grant would be inert anyway (RLS refuses the insert under an invoker
-- function), and leaving it off keeps the intent legible: clients read and
-- delete their history, the API writes it.
grant execute on function public.record_prompt(uuid, text, text, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
