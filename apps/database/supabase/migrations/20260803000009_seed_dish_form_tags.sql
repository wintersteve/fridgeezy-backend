-- The dish_form vocabulary: how the dish is built and eaten.
--
-- Deliberately a short, closed list of forms a cook would recognise on sight.
-- It is not a cooking-method taxonomy — "braised" and "poached" belong to the
-- technique data, not here — and not a catch-all: a dish that is simply a plate
-- of food carries no form at all, which is the common case and must stay cheap.
--
-- Flat on purpose. Cuisines are hierarchical because "japanese is a kind of east
-- asian" is true and useful; "stew is a kind of soup" is an argument, not a
-- fact, and nesting it would make a soup filter quietly return stews.
--
-- Mirrored in seeds/002_tags.sql so a `db reset` produces the same rows; kept
-- here as well because seeds only run on reset and existing databases would
-- never see them.
insert into tags (name, canonical_id, type)
values ('soup', 'soup', 'dish_form'),
       ('stew', 'stew', 'dish_form'),
       ('salad', 'salad', 'dish_form'),
       ('sandwich', 'sandwich', 'dish_form'),
       ('wrap', 'wrap', 'dish_form'),
       ('pizza', 'pizza', 'dish_form'),
       ('pasta', 'pasta', 'dish_form'),
       ('noodles', 'noodles', 'dish_form'),
       ('curry', 'curry', 'dish_form'),
       ('stir fry', 'stir_fry', 'dish_form'),
       ('roast', 'roast', 'dish_form'),
       ('bake', 'bake', 'dish_form'),
       ('casserole', 'casserole', 'dish_form'),
       ('grill', 'grill', 'dish_form'),
       ('pie', 'pie', 'dish_form'),
       ('dumpling', 'dumpling', 'dish_form'),
       ('rice dish', 'rice_dish', 'dish_form'),
       ('porridge', 'porridge', 'dish_form'),
       ('pancake', 'pancake', 'dish_form'),
       ('skewer', 'skewer', 'dish_form')
on conflict (name, type) do nothing;

-- The spellings a model reaches for when it does not use ours.
insert into tag_aliases (tag_id, alias, type)
select t.id, a.alias, t.type
from tags t
         join (values ('soup', 'broth'),
                      ('soup', 'chowder'),
                      ('soup', 'bisque'),
                      ('stew', 'casserole stew'),
                      ('stew', 'braise'),
                      ('salad', 'green salad'),
                      ('sandwich', 'burger'),
                      ('sandwich', 'sub'),
                      ('wrap', 'burrito'),
                      ('wrap', 'taco'),
                      ('pasta', 'pasta dish'),
                      ('noodles', 'noodle dish'),
                      ('stir fry', 'stir-fry'),
                      ('stir fry', 'stirfry'),
                      ('rice dish', 'fried rice'),
                      ('rice dish', 'risotto'),
                      ('dumpling', 'dumplings'),
                      ('skewer', 'kebab'),
                      ('skewer', 'skewers'),
                      ('pancake', 'fritter'))
    as a(canon, alias) on a.canon = t.canonical_id
where t.type = 'dish_form'
on conflict do nothing;
