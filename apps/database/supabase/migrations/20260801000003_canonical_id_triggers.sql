-- Trigger functions that stamp canonical_id on write.
--
-- Reproduced VERBATIM from the live database, inline regexp and all. They do
-- NOT call normalize_to_canonical_id() even though they implement the same
-- rule, and set_ingredient_canonical_id in particular does NOT singularise the
-- way ingredient_canonical_id() does.
--
-- That divergence is a real defect — 169 of 724 ingredient rows have a
-- canonical_id that ingredient_canonical_id(name) would not produce, so a
-- lookup keyed on the function misses them. It is preserved here on purpose: a
-- schema consolidation must not quietly change behaviour. Fix it as its own
-- migration, with a backfill, so the change is reviewable and reversible.

create or replace function public.set_category_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
    return new;
end;
$function$;

create or replace function public.set_ingredient_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
    return new;
end;
$function$;

create or replace function public.set_recipe_suggestion_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
    return new;
end;
$function$;

create or replace function public.set_tag_alias_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := regexp_replace(lower(trim(new.alias)), '[^a-z0-9]+', '_', 'g');
    return new;
end;
$function$;

-- Units additionally strip leading/trailing underscores.
create or replace function public.set_unit_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := regexp_replace(
        regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g'),
        '^_|_$', '', 'g'
    );
    return new;
end;
$function$;

-- Seeds profile_settings for every new profile.
create or replace function public.handle_new_profile()
    returns trigger
    language plpgsql
    security definer
as $function$
begin
    insert into public.profile_settings (profile_id)
    values (NEW.id);
    return NEW;
end;
$function$;

-- Keeps recipes.favourite_count in step with the interaction rows, so the
-- discovery ranking never has to aggregate on read.
create or replace function public.sync_recipe_favourite_count()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
as $function$
begin
    if (TG_OP = 'DELETE' or TG_OP = 'UPDATE') and old.interaction_type = 'favourite' then
        update recipes
        set favourite_count = greatest(favourite_count - 1, 0)
        where id = old.recipe_id;
    end if;

    if (TG_OP = 'INSERT' or TG_OP = 'UPDATE') and new.interaction_type = 'favourite' then
        update recipes
        set favourite_count = favourite_count + 1
        where id = new.recipe_id;
    end if;

    if TG_OP = 'DELETE' then
        return old;
    end if;

    return new;
end;
$function$;
