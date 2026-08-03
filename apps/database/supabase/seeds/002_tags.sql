-- Seed canonical component tags (underscore format with canonical_id = name)
insert into tags (name, canonical_id, type)
values
    -- Sauces & Liquids (3)
    ('sauce', 'sauce', 'component'),
    ('stock', 'stock', 'component'),
    ('gravy', 'gravy', 'component'),

    -- Thickening Agents (2)
    ('roux', 'roux', 'component'),
    ('slurry', 'slurry', 'component'),

    -- Seasonings & Flavoring (6)
    ('spice blend', 'spice_blend', 'component'),
    ('paste', 'paste', 'component'),
    ('rub', 'rub', 'component'),
    ('marinade', 'marinade', 'component'),
    ('brine', 'brine', 'component'),
    ('cure', 'cure', 'component'),

    -- Doughs & Batters (3)
    ('dough', 'dough', 'component'),
    ('batter', 'batter', 'component'),
    ('pastry', 'pastry', 'component'),

    -- Dressings (2)
    ('vinaigrette', 'vinaigrette', 'component'),
    ('dressing', 'dressing', 'component'),

    -- Dessert Components (3)
    ('custard', 'custard', 'component'),
    ('curd', 'curd', 'component'),
    ('caramel', 'caramel', 'component'),

    -- Toppings (1)
    ('crumb', 'crumb', 'component'),

    -- Preserves (3)
    ('pickle', 'pickle', 'component'),
    ('jam', 'jam', 'component'),
    ('compote', 'compote', 'component'),

    -- Sweeteners & Finishing (3)
    ('syrup', 'syrup', 'component'),
    ('glaze', 'glaze', 'component'),
    ('icing', 'icing', 'component'),

    -- General (2)
    ('dish', 'dish', 'component'),
    ('puree', 'puree', 'component')
on conflict (name, type) do nothing;

-- ============================================================================
-- DIETARY TAGS (canonical tags with underscore format)
-- ============================================================================

-- Seed canonical dietary tags (underscore format with canonical_id = name)
insert into tags (name, canonical_id, type)
values ('gluten free', 'gluten_free', 'dietary'),
       ('dairy free', 'dairy_free', 'dietary'),
       ('nut free', 'nut_free', 'dietary'),
       ('egg free', 'egg_free', 'dietary'),
       ('soy free', 'soy_free', 'dietary'),
       ('shellfish free', 'shellfish_free', 'dietary'),
       ('sesame free', 'sesame_free', 'dietary'),
       ('low carb', 'low_carb', 'dietary'),
       ('low fat', 'low_fat', 'dietary'),
       ('low sodium', 'low_sodium', 'dietary'),
       ('high protein', 'high_protein', 'dietary') on conflict (name, type) do nothing;

-- Seed dietary tags (single-word canonical tags with canonical_id = name)
insert into tags (name, canonical_id, type)
values
    -- Core diet types
    ('vegan', 'vegan', 'dietary'),
    ('vegetarian', 'vegetarian', 'dietary'),
    ('pescatarian', 'pescatarian', 'dietary'),
    ('flexitarian', 'flexitarian', 'dietary'),

    -- Popular nutritional regimes / lifestyle
    ('keto', 'keto', 'dietary'),
    ('paleo', 'paleo', 'dietary'),

    -- Religious / cultural restrictions
    ('halal', 'halal', 'dietary'),
    ('kosher', 'kosher', 'dietary') on conflict (name, type) do nothing;

-- ============================================================================
-- COURSE TAGS (all single-word canonical tags)
-- ============================================================================

-- Seed course tags (all canonical with canonical_id = name)
insert into tags (name, canonical_id, type)
values ('appetizer', 'appetizer', 'course'),
       ('main', 'main', 'course'),
       ('side', 'side', 'course'),
       ('dessert', 'dessert', 'course') on conflict (name, type) do nothing;

-- ============================================================================
-- DISH FORM TAGS (what shape the dish takes — orthogonal to course)
-- ============================================================================

-- A soup can be an appetizer or a main, a salad a side or a meal, so form
-- cannot live in `course` without breaking its mutually-exclusive slots.
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
       ('skewer', 'skewer', 'dish_form') on conflict (name, type) do nothing;
