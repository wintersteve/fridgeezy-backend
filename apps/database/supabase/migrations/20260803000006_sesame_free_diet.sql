-- Make `sesame` filterable: the dietary tag users pick, and the rule that turns
-- the ingredient property into a recipe-level claim.
--
-- Both halves are needed. Without the tag there is nothing to select in the app;
-- without the `dietary_rules` row the tag would fall through to the
-- model-assigned `recipe_tags`, which is exactly the guesswork the derived
-- filter replaced.
--
-- Inserted here rather than only in seeds/002_tags.sql because seeds run on
-- `db reset` alone — a database that already exists would never see it. The seed
-- carries the same row so a fresh reset matches.
insert into tags (name, canonical_id, type)
values ('sesame free', 'sesame_free', 'dietary')
on conflict (name, type) do nothing;

insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join (values ('sesame-free'), ('no sesame'), ('without sesame')) as a(alias)
where canonical_id = 'sesame_free'
on conflict do nothing;

insert into dietary_rules (diet_canonical_id, forbidden)
values ('sesame_free', '{sesame}')
on conflict (diet_canonical_id) do update set forbidden = excluded.forbidden;
