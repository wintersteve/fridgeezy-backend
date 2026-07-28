-- Update persist_suggestion to accept and store name_en
create or replace function persist_suggestion(
    p_name text,
    p_description text,
    p_difficulty difficulty_type,
    p_ingredient_ids uuid[],
    p_tag_ids uuid[],
    p_name_en text default null
)
returns uuid
language plpgsql
as $$
declare
    v_suggestion_id uuid;
    v_ingredient_id uuid;
    v_tag_id uuid;
begin
    -- Insert new suggestion
    insert into recipe_suggestions (name, description, difficulty, name_en)
    values (p_name, p_description, p_difficulty, p_name_en)
    returning id into v_suggestion_id;

    -- Insert ingredient associations
    foreach v_ingredient_id in array p_ingredient_ids loop
        insert into recipe_suggestion_ingredients (recipe_suggestion_id, ingredient_id)
        values (v_suggestion_id, v_ingredient_id)
        on conflict (recipe_suggestion_id, ingredient_id) do nothing;
    end loop;

    -- Insert tag associations
    foreach v_tag_id in array p_tag_ids loop
        insert into recipe_suggestion_tags (recipe_suggestion_id, tag_id)
        values (v_suggestion_id, v_tag_id)
        on conflict (recipe_suggestion_id, tag_id) do nothing;
    end loop;

    return v_suggestion_id;
end;
$$;

COMMENT on function persist_suggestion(text, text, difficulty_type, uuid[], uuid[], text) is
'Atomically persists a recipe suggestion with relations. Returns the new suggestion ID.
Accepts optional p_name_en for the English name of the recipe.';
