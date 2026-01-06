-- Function to fetch all prompt_variable_type enum values
create or replace function get_prompt_variable_types()
returns table (variable_type text) as $$
begin
    return query
    select unnest(enum_range(null::prompt_variable_type))::text;
end;
$$ language plpgsql stable;
