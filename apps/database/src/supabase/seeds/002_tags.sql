-- Seed data for tags table and tag_aliases table
-- Strategy: Insert canonical tags with canonical_id = name, then insert aliases into tag_aliases table

-- ============================================================================
-- CANONICAL TAGS - These are the authoritative versions
-- canonical_id = name for all canonical tags (underscore format)
-- ============================================================================

-- Seed canonical component tags (underscore format with canonical_id = name)
insert into tags (name, canonical_id, type)
values ('demi glace', 'demi_glace', 'component'),
       ('aromatic base', 'aromatic_base', 'component'),
       ('bouquet garni', 'bouquet_garni', 'component'),
       ('spice blend', 'spice_blend', 'component'),
       ('compound butter', 'compound_butter', 'component'),
       ('infused oil', 'infused_oil', 'component'),
       ('rendered fat', 'rendered_fat', 'component') on conflict (name, type) do nothing;

-- ============================================================================
-- COMPONENT TAGS (single-word canonical tags)
-- ============================================================================

-- Seed component tags (all single-word tags are canonical with canonical_id = name)
insert into tags (name, canonical_id, type)
values
    -- Liquids & Bases
    ('sauce', 'sauce', 'component'),
    ('stock', 'stock', 'component'),
    ('broth', 'broth', 'component'),
    ('fond', 'fond', 'component'),
    ('fumet', 'fumet', 'component'),
    ('glace', 'glace', 'component'),
    ('jus', 'jus', 'component'),
    ('gravy', 'gravy', 'component'),
    ('reduction', 'reduction', 'component'),

    -- Thickeners & Binders
    ('roux', 'roux', 'component'),
    ('slurry', 'slurry', 'component'),
    ('liaison', 'liaison', 'component'),
    ('thickener', 'thickener', 'component'),

    -- Aromatic Foundations
    ('sachet', 'sachet', 'component'),

    -- Seasonings & Flavoring
    ('paste', 'paste', 'component'),
    ('seasoning', 'seasoning', 'component'),
    ('rub', 'rub', 'component'),
    ('marinade', 'marinade', 'component'),
    ('brine', 'brine', 'component'),
    ('cure', 'cure', 'component'),

    -- Doughs, Batters & Wrappers
    ('dough', 'dough', 'component'),
    ('batter', 'batter', 'component'),
    ('pastry', 'pastry', 'component'),
    ('wrapper', 'wrapper', 'component'),

    -- Emulsions & Dressings
    ('emulsion', 'emulsion', 'component'),
    ('vinaigrette', 'vinaigrette', 'component'),
    ('dressing', 'dressing', 'component'),

    -- Fats & Finishing
    ('dripping', 'dripping', 'component'),

    -- Creams & Custards
    ('cream', 'cream', 'component'),
    ('custard', 'custard', 'component'),
    ('curd', 'curd', 'component'),
    ('ganache', 'ganache', 'component'),
    ('mousse', 'mousse', 'component'),
    ('sabayon', 'sabayon', 'component'),

    -- Toppings & Textures
    ('crumb', 'crumb', 'component'),
    ('crouton', 'crouton', 'component'),
    ('garnish', 'garnish', 'component'),
    ('meringue', 'meringue', 'component'),
    ('streusel', 'streusel', 'component'),

    -- Preserves & Ferments
    ('pickle', 'pickle', 'component'),
    ('ferment', 'ferment', 'component'),
    ('confit', 'confit', 'component'),
    ('preserve', 'preserve', 'component'),
    ('jam', 'jam', 'component'),
    ('compote', 'compote', 'component'),
    ('chutney', 'chutney', 'component'),
    ('relish', 'relish', 'component'),

    -- Sweeteners & Sugar Work
    ('syrup', 'syrup', 'component'),
    ('caramel', 'caramel', 'component'),
    ('coulis', 'coulis', 'component'),
    ('glaze', 'glaze', 'component'),
    ('icing', 'icing', 'component'),
    ('fondant', 'fondant', 'component'),
    ('praline', 'praline', 'component'),

    -- Miscellaneous
    ('dish', 'dish', 'component'),
    ('puree', 'puree', 'component'),
    ('foam', 'foam', 'component'),
    ('gel', 'gel', 'component'),
    ('infusion', 'infusion', 'component'),
    ('extract', 'extract', 'component'),
    ('tincture', 'tincture', 'component') on conflict (name, type) do nothing;

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
