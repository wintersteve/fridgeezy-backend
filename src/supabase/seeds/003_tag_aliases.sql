-- Gluten free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('gluten-free'), ('no gluten'), ('without gluten'), ('glutenless') ) as a(alias)
where canonical_id = 'gluten_free' on conflict do nothing;

-- Dairy free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('dairy-free'), ('no dairy'), ('without dairy'), ('milk free') ) as a(alias)
where canonical_id = 'dairy_free' on conflict do nothing;

-- Nut free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('nut-free'), ('no nuts'), ('without nuts'), ('peanut free') ) as a(alias)
where canonical_id = 'nut_free' on conflict do nothing;

-- Egg free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('egg-free'), ('no eggs'), ('without eggs'), ('eggless') ) as a(alias)
where canonical_id = 'egg_free' on conflict do nothing;

-- Soy free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('soy-free'), ('no soy'), ('without soy'), ('soya free') ) as a(alias)
where canonical_id = 'soy_free' on conflict do nothing;

-- Shellfish free
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('shellfish-free'),
                             ('no shellfish'),
                             ('without shellfish'),
                             ('shellfishless') ) as a(alias)
where canonical_id = 'shellfish_free' on conflict do nothing;

-- Low carb
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('low-carb'), ('reduced carb'), ('lower carb'), ('low carbohydrate') ) as a(alias)
where canonical_id = 'low_carb' on conflict do nothing;

-- Low fat
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('low-fat'), ('reduced fat'), ('lower fat'), ('low fat diet') ) as a(alias)
where canonical_id = 'low_fat' on conflict do nothing;

-- Low sodium
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('low-sodium'), ('reduced sodium'), ('lower sodium'), ('low salt') ) as a(alias)
where canonical_id = 'low_sodium' on conflict do nothing;

-- High protein
insert into tag_aliases (tag_id, alias, type)
select id, alias, type
from tags
         cross join ( values ('high-protein'), ('protein rich'), ('higher protein'), ('high protein diet') ) as a(alias)
where canonical_id = 'high_protein' on conflict do nothing;
