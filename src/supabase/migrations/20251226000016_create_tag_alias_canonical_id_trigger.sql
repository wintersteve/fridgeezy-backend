create
or replace function set_tag_alias_canonical_id()
returns trigger as $$
begin
  new.canonical_id
:=
    regexp_replace(lower(trim(new.alias)), '[^a-z0-9]+', '_', 'g');
return new;
end;
$$
language plpgsql;

create trigger tag_alias_canonical_id_trigger
    before insert or
update on tag_aliases for each row execute function set_tag_alias_canonical_id();
