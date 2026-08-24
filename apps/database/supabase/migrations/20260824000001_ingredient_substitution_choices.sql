------------------------------------------------------------------------------
-- profile_ingredient_substitutions: which swap the cook actually used
------------------------------------------------------------------------------
--
-- `/substitutes/generate` has always recorded the QUESTION and never the
-- ANSWER. `recordTasteSignal(req, "substitution", …)` writes what the cook
-- asked to replace, because that request reaches the server; which of the two
-- or three offered swaps they then tapped never does. It went into
-- `useIngredientSubstitutionStore` — zustand over AsyncStorage — whose own
-- docstring says "Persisted … It has to be: nothing else records it".
--
-- That is the shape `profile_prompts` (`20260822000004`) found the chat history
-- in, down to the storage layer: the one signal worth having, on one phone,
-- gone at reinstall and absent from every second device.
--
-- ## Why it is worth having
--
-- Everything else that could populate a substitution corpus is INVENTED.
-- `ingredient_substitutes` was a table of LLM-generated pairs, filled by
-- `generate-ingredient-substitutes.ts`, and `20260727000009` dropped it as
-- unused. This is the other kind of evidence — revealed, in a real dish, by
-- somebody who was about to cook it — and it arrives as a byproduct of a
-- feature that already exists rather than at ~5N model calls to guess.
--
-- The eventual reader is the same one `menu_pairings_for_recipe`
-- (`20260822000001`) got: retrieve what people already do before paying a model
-- to invent it. That reader is NOT built here, deliberately — a corpus with
-- nothing in it retrieves nothing, and the decision to spend on retrieval
-- belongs after the numbers exist rather than before them. Note for whoever
-- builds it: RLS here is owner-scoped, so an aggregate across profiles has to
-- be SECURITY DEFINER with the rule in its own WHERE clause, exactly as
-- `menu_pairings_for_recipe` had to be.
--
-- ## STATE, not events
--
-- One row per (profile, recipe ingredient), upserted. The alternative — an
-- append-only log of taps — is worse on every axis that matters here:
--
--   * A cook who tries olive oil, clears it, and tries ghee has expressed ONE
--     opinion. A log records two, and weights the corpus by fiddling.
--   * `on conflict … do update` makes the write idempotent, so a client that
--     retries or double-fires costs nothing. A log needs a dedup key to get
--     there, which is this unique index arriving late.
--   * The table is bounded by dishes people cook rather than by taps, which is
--     the same argument `profile_taste_signals` makes for counting occurrences
--     instead of storing an event per request.
--
-- So the corpus weight is "distinct cooks who adopted this swap in this dish",
-- which is the number that means something, and not "taps", which is not.
--
-- ## The context is snapshotted, not joined
--
-- `dish_form` and `cuisine` are read off the recipe at write time. Two reasons,
-- and the second is the load-bearing one:
--
--   * A corpus query groups on them, and grouping through two joins into
--     `recipe_tags` on every read is work this can do once.
--   * The choice was made in the dish AS IT WAS. Re-tag a recipe from `bake` to
--     `pie` next month and the swap was still chosen for a bake; a join would
--     silently rewrite history to say otherwise. `menu_courses` snapshots
--     `name` and `image` off the catalogue for the same reason.
--
-- ## Omission is a real answer and is recorded as one
--
-- "Leave it out" is a legitimate first suggestion in the substitutes prompt, so
-- it is a legitimate row here: `substitute_ingredient_id` is simply NULL,
-- because no catalogue ingredient is named that. NULL there is the honest
-- reading of "the cook did not reach for another ingredient" and it must not be
-- filtered out as a defect — "people just skip this" is one of the more useful
-- things this table can eventually say.

create table if not exists profile_ingredient_substitutions
(
    id                      uuid primary key                  default gen_random_uuid(),
    profile_id              uuid                     not null references profiles (id) on delete cascade,

    -- CASCADES, like `profile_prompts.recipe_id`: a swap on a dish that no
    -- longer exists resolves to nothing a reader could open, and the orphan
    -- sweep must be free to take it. `recipe_id` is derivable from
    -- `recipe_ingredient_id` and kept anyway — the client reads "my swaps for
    -- this recipe", which is this column's index and no join.
    recipe_id               uuid                     not null references recipes (id) on delete cascade,
    recipe_ingredient_id    uuid                     not null references recipe_ingredients (id) on delete cascade,

    -- What was replaced. The id is the catalogue row; the canonical id is what
    -- survives it being merged away, and is what a corpus query groups on.
    replaced_ingredient_id  uuid                     not null references ingredients (id) on delete cascade,
    replaced_canonical_id   text                     not null,

    -- What was chosen. NAME as the model wrote it, because that is what the
    -- cook read and it may name nothing in the catalogue; the canonical id so
    -- two spellings of one answer collapse; the id only when it resolves.
    substitute_name         text                     not null,
    substitute_canonical_id text                     not null,
    substitute_ingredient_id uuid                    references ingredients (id) on delete set null,

    -- The conversion exactly as it was offered, unparsed. "1 tbsp per clove" is
    -- part of the edge and no scalar can hold it — the same reason
    -- `SubstituteOptionSchema.ratio` is free text on the wire.
    ratio                   text,

    -- Snapshotted context. Both nullable: not every recipe carries either tag,
    -- and a missing one is "unknown", never "none".
    dish_form               text,
    cuisine                 text,

    created_at              timestamp with time zone not null default now(),
    updated_at              timestamp with time zone not null default now(),

    constraint profile_ingredient_substitutions_unique
        unique (profile_id, recipe_ingredient_id),

    -- A thing cannot stand in for itself. The dropped `ingredient_substitutes`
    -- carried the same check on ids; this one is on canonical ids, which is the
    -- identity that actually holds when a row is merged away.
    constraint profile_ingredient_substitutions_not_self
        check (substitute_canonical_id <> replaced_canonical_id),

    constraint profile_ingredient_substitutions_substitute_named
        check (substitute_canonical_id <> '')
);

create index if not exists idx_profile_ingredient_substitutions_profile_recipe
    on profile_ingredient_substitutions using btree (profile_id, recipe_id);

-- The corpus read, when it comes: "what do people use instead of X, in a Y".
create index if not exists idx_profile_ingredient_substitutions_edge
    on profile_ingredient_substitutions using btree (replaced_canonical_id, dish_form);

comment on table profile_ingredient_substitutions is
    'Which substitute a cook actually used, per recipe ingredient. State, not events: one row per (profile, recipe_ingredient), upserted. Written only by record_ingredient_substitution.';

------------------------------------------------------------------------------
-- RLS: read and forget your own, write through the function only
------------------------------------------------------------------------------
--
-- Select and delete for the owner, mirroring `profile_taste_signals` — and for
-- its reason, which applies twice over here. This is a record of what somebody
-- cooked and how; "forget that" has to be possible without a support request,
-- and a deleted row costs nobody anything.
--
-- DELETE is granted rather than routed through a second function precisely
-- because the client needs it: clearing a swap in the sheet must retract the
-- row, or the corpus fills with swaps people tried and abandoned. That is one
-- PostgREST call against the owner's own row, with nothing to derive.
--
-- INSERT and UPDATE are revoked as well as unpolicied. The revoke is not
-- redundant, and `20260821000001` states the reason: with RLS on and no write
-- policy an UPDATE matches zero rows and returns **204**, so a client writing
-- the wrong way fails silently and looks fine.

alter table profile_ingredient_substitutions enable row level security;

create policy users_read_own_substitutions on profile_ingredient_substitutions for select
    using (profile_id = current_profile_id());

create policy users_forget_own_substitutions on profile_ingredient_substitutions for delete
    using (profile_id = current_profile_id());

revoke insert, update on profile_ingredient_substitutions from anon, authenticated;

------------------------------------------------------------------------------
-- record_ingredient_substitution
------------------------------------------------------------------------------
--
-- ## SECURITY DEFINER, where `record_taste_signal` is INVOKER
--
-- That inversion is deliberate and worth understanding before copying either.
-- `record_taste_signal` is INVOKER *as its gate*: no insert policy exists, so a
-- client call fails RLS and only the service role gets through, because a
-- client that can write there can forge the record of what a person asked.
--
-- Nothing equivalent is available here. The tap happens entirely on the device
-- — the substitutes stream closed seconds earlier and there is no request in
-- flight to piggyback the write onto — so the choice reaches the server through
-- a client call or it does not reach it at all. That is the same forcing
-- `record_menu` describes: only the client knows.
--
-- What that costs is bounded by making the function derive everything it can
-- rather than accept it, the way `save_menu` reads its course snapshot off the
-- catalogue instead of taking it from the caller. The profile is
-- `current_profile_id()`, never a parameter. The recipe, the replaced
-- ingredient, both canonical ids and the dish context are all read from
-- `p_recipe_ingredient_id`. A caller can therefore misreport WHICH swap they
-- made; it cannot claim to be somebody else, write against a recipe it may not
-- read, or invent the context the choice was made in.
--
-- ## One row per cook per ingredient, so changing your mind is an UPDATE
--
-- `on conflict … do update` is what makes the corpus weight "cooks who adopted
-- this" rather than "taps". It also makes the call idempotent, which matters
-- because the caller is fire-and-forget and will retry on a flaky network.

create or replace function public.record_ingredient_substitution(
    p_recipe_ingredient_id uuid,
    p_substitute_name text,
    p_ratio text default null
)
    returns profile_ingredient_substitutions
    language plpgsql
    security definer
    set search_path = public, pg_temp
as
$function$
declare
    v_profile_id   uuid := current_profile_id();
    v_recipe_id    uuid;
    v_ingredient   uuid;
    v_replaced     text;
    v_recipe_owner uuid;
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

    select ri.recipe_id, ri.ingredient_id, i.canonical_id, r.created_by
    into v_recipe_id, v_ingredient, v_replaced, v_recipe_owner
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
    if not recipe_is_visible(v_recipe_owner) then
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
$function$;

revoke all on function public.record_ingredient_substitution(uuid, text, text) from public;
grant execute on function public.record_ingredient_substitution(uuid, text, text) to authenticated;

comment on function public.record_ingredient_substitution(uuid, text, text) is
    'Record the substitute a cook actually used for one recipe ingredient. SECURITY DEFINER because the choice never reaches the server any other way; derives the profile, recipe, canonical ids and dish context rather than accepting them.';

notify pgrst, 'reload schema';
