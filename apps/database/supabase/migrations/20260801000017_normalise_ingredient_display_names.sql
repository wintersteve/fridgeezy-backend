-- Normalise ingredient display names to Title Case.
--
-- The catalog had accumulated three spellings of the same convention: 624
-- lowercase, 85 Title Case, 24 mixed. Clients title-case at render time, so the
-- inconsistency was invisible in some screens and not others — and it made the
-- suggestion payload look wrong once it started returning catalog names rather
-- than the model's.
--
-- SAFE BECAUSE OF 20260801000016. canonical_id is now derived through
-- ingredient_canonical_id(), which lowercases and singularises, so it is
-- invariant under a change of display casing. Verified before running:
-- 648 names change, 0 canonical_ids change, 0 name collisions. Before that
-- migration, rewriting a name would have rewritten its identity with it.
--
-- Whitespace is collapsed at the same time — "olive  oil" and "olive oil" would
-- otherwise stay distinct display names for one canonical row.
--
-- NOT singularised. 159 names read as plural, but "Baked Beans", "Grits" and
-- "Oats" are correctly plural; that needs judgement per name, not a rule, and
-- it no longer affects matching.

-- Proper title case, not plain initcap(): initcap capitalises every word, which
-- turns "corn on the cob" into "Corn On The Cob". Small words stay lowercase
-- unless they lead the name.
create or replace function public.title_case_name(input text)
    returns text
    language sql
    immutable
as $function$
    select string_agg(
        case
            when ord = 1
                or lower(word) not in
                   ('a','an','and','as','at','by','for','from','in','of','on','or','the','to','with')
            then initcap(word)
            else lower(word)
        end,
        ' ' order by ord
    )
    from unnest(string_to_array(regexp_replace(trim(input), '\s+', ' ', 'g'), ' '))
         with ordinality as t(word, ord);
$function$;

update ingredients
set name = title_case_name(name)
where name is distinct from title_case_name(name);

-- Enforce it on write, so the catalog cannot drift back. There are three
-- writers — seed-ingredients, the LLM create branch in match-ingredients, and
-- persist_recipe's own INSERT — and expecting each to remember the convention
-- is what produced three spellings in the first place. Same reasoning as
-- canonical_id: make it an invariant the database keeps, not a habit.
--
-- Safe for acronyms only because there are none: no name in the catalog
-- contained an all-caps run before this ran. Should a "MSG" or "AP Flour" ever
-- be needed, this is the function to teach about it.
create or replace function public.set_ingredient_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.name := title_case_name(new.name);
    new.canonical_id := ingredient_canonical_id(new.name);
    return new;
end;
$function$;
