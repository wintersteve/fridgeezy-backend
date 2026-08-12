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

-- Cuisine aliases — the spellings a model reaches for when it does not use ours.
--
-- Mirrors 20260812000002_cuisine_tag_aliases.sql, which carries the full
-- rationale: which shapes belong here (spelling variants, and regional names
-- with no seeded tag of their own), which are deliberately excluded as
-- ambiguous, and why an alias cannot merge two real tags such as
-- persian/iranian. Keep the two lists in step.
--
-- The join is on canonical_id, so multi-word targets are underscored. Getting
-- that wrong fails silently — the insert succeeds and simply skips those rows,
-- which is how four dish_form aliases went missing for a week.
insert into tag_aliases (tag_id, alias, type)
select t.id, a.alias, t.type
from tags t
         join (values ('sichuan', 'szechuan'),
                      ('sichuan', 'szechwan'),
                      ('sichuan', 'sichuanese'),
                      ('hunan', 'hunanese'),
                      ('shanghainese', 'shanghai'),
                      ('cantonese', 'hong kong'),
                      ('cantonese', 'guangdong'),
                      ('chinese', 'peking'),
                      ('chinese', 'beijing'),
                      ('italian', 'tuscan'),
                      ('italian', 'sicilian'),
                      ('italian', 'neapolitan'),
                      ('italian', 'roman'),
                      ('italian', 'sardinian'),
                      ('french', 'provencal'),
                      ('french', 'provençal'),
                      ('french', 'alsatian'),
                      ('french', 'breton'),
                      ('french', 'burgundian'),
                      ('german', 'bavarian'),
                      ('german', 'swabian'),
                      ('austrian', 'viennese'),
                      ('indian', 'punjabi'),
                      ('indian', 'bengali'),
                      ('indian', 'gujarati'),
                      ('indian', 'keralan'),
                      ('indian', 'goan'),
                      ('indian', 'hyderabadi'),
                      ('indian', 'south indian'),
                      ('indian', 'north indian'),
                      ('indian', 'desi'),
                      ('mexican', 'oaxacan'),
                      ('mexican', 'yucatecan'),
                      ('dutch', 'holland'),
                      ('turkish', 'anatolian'),
                      ('turkish', 'ottoman'),
                      ('laotian', 'lao'),
                      ('sri_lankan', 'ceylonese'),
                      ('burmese', 'burma'),
                      ('thai', 'siamese'),
                      ('taiwanese', 'taiwan'),
                      ('north_african', 'maghrebi'),
                      ('north_african', 'maghreb'),
                      ('middle_eastern', 'arab'),
                      ('middle_eastern', 'arabic'),
                      ('scandinavian', 'nordic'),
                      ('southern', 'soul food'))
             as a(canon, alias) on a.canon = t.canonical_id
where t.type = 'cuisine'
on conflict do nothing;

-- The four dish_form aliases 20260803000009 meant to insert and did not; it
-- joined on canonical_id but passed names, so 'stir fry' never matched
-- 'stir_fry'. Repeated here so a reset produces the repaired set.
insert into tag_aliases (tag_id, alias, type)
select t.id, a.alias, t.type
from tags t
         join (values ('stir_fry', 'stir-fry'),
                      ('stir_fry', 'stirfry'),
                      ('rice_dish', 'fried rice'),
                      ('rice_dish', 'risotto'))
             as a(canon, alias) on a.canon = t.canonical_id
where t.type = 'dish_form'
on conflict do nothing;
