create or replace function set_category_canonical_id()
returns trigger as $$
begin
  new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
  return new;
end;
$$ language plpgsql;

create trigger set_category_canonical_id_trigger
    before insert or update on categories
    for each row execute function set_category_canonical_id();
