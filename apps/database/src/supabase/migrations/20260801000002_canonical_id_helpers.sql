-- Canonical-id helpers.
--
-- These define the identity rule for a name: lowercase, every run of
-- non-alphanumerics collapsed to a single underscore. `canonicalizeName` in
-- @fridgeezy/toolkit mirrors `normalize_to_canonical_id` exactly, because
-- `recipes` matches by name in application code and has to agree with the
-- triggers that populate `canonical_id` here.
--
-- Declared before every table, since the BEFORE INSERT/UPDATE triggers that
-- call them are attached alongside their tables.

create or replace function public.normalize_to_canonical_id(input_text text)
    returns text
    language plpgsql
    immutable
as $function$
begin
    return lower(
        regexp_replace(
            regexp_replace(input_text, '[^a-zA-Z0-9]+', '_', 'g'),
            '_+', '_', 'g'
        )
    );
end;
$function$;

-- Collapses a plural head noun so "tomatoes" and "tomato" are one ingredient.
-- Deliberately conservative: `ss`/`us`/`is` endings are left alone so "glass",
-- "asparagus" and "basis" survive intact.
create or replace function public.singularize_token(tok text)
    returns text
    language plpgsql
    immutable
as $function$
begin
    if length(tok) <= 3 then
        return tok;
    end if;
    -- berries -> berry, cherries -> cherry
    if tok ~ 'ies$' and length(tok) > 4 then
        return left(tok, length(tok) - 3) || 'y';
    end if;
    -- tomatoes -> tomato, boxes -> box, dishes -> dish, peaches -> peach
    if tok ~ '(oes|ses|xes|zes|ches|shes)$' then
        return left(tok, length(tok) - 2);
    end if;
    -- apples -> apple, olives -> olive; but NOT ss/us/is (glass, asparagus, basis)
    if tok ~ 's$' and tok !~ '(ss|us|is)$' then
        return left(tok, length(tok) - 1);
    end if;
    return tok;
end;
$function$;

-- Ingredients only: the canonical rule plus singularisation of the LAST token,
-- so "Cherry Tomatoes" -> cherry_tomato while "cherry" stays the qualifier.
create or replace function public.ingredient_canonical_id(input_text text)
    returns text
    language plpgsql
    immutable
as $function$
declare
    base TEXT;
    parts TEXT[];
    last_idx INT;
begin
    base := trim(both '_' from normalize_to_canonical_id(input_text));
    if base = '' then
        return base;
    end if;
    parts := string_to_array(base, '_');
    last_idx := array_length(parts, 1);
    parts[last_idx] := singularize_token(parts[last_idx]);
    return array_to_string(parts, '_');
end;
$function$;

create or replace function public.has_user(email character varying)
    returns boolean
    language plpgsql
    security definer
as $function$
begin
    return exists (select 1
                   from auth.users as u
                   where u.email = has_user.email);
end;
$function$;
