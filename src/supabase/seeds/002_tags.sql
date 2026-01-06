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
-- CUISINE TAGS (canonical tags with underscore format for multi-word cuisines)
-- ============================================================================

-- Seed canonical cuisine tags (underscore format with canonical_id = name)
insert into tags (name, canonical_id, type)
values ('eastern european', 'eastern_european', 'cuisine'),
       ('sri lankan', 'sri_lankan', 'cuisine'),
       ('south african', 'south_african', 'cuisine'),
       ('north african', 'north_african', 'cuisine'),
       ('west african', 'west_african', 'cuisine'),
       ('east african', 'east_african', 'cuisine'),
       ('south asian', 'south_asian', 'cuisine'),
       ('north korean', 'north_korean', 'cuisine'),
       ('east asian', 'east_asian', 'cuisine'),
       ('southeast asian', 'southeast_asian', 'cuisine'),
       ('central asian', 'central_asian', 'cuisine'),
       ('tex mex', 'tex_mex', 'cuisine'),
       ('costa rican', 'costa_rican', 'cuisine'),
       ('puerto rican', 'puerto_rican', 'cuisine'),
       ('new zealand', 'new_zealand', 'cuisine'),
       ('pacific islander', 'pacific_islander', 'cuisine'),
       ('north american', 'north_american', 'cuisine'),
       ('south american', 'south_american', 'cuisine'),
       ('middle eastern', 'middle_eastern', 'cuisine'),
       ('latin american', 'latin_american', 'cuisine') on conflict (name, type) do nothing;

-- Seed cuisine tags (single-word canonical tags with canonical_id = name)
insert into tags (name, canonical_id, type)
values
    -- Europe
    ('italian', 'italian', 'cuisine'),
    ('french', 'french', 'cuisine'),
    ('spanish', 'spanish', 'cuisine'),
    ('portuguese', 'portuguese', 'cuisine'),
    ('greek', 'greek', 'cuisine'),
    ('turkish', 'turkish', 'cuisine'),
    ('german', 'german', 'cuisine'),
    ('austrian', 'austrian', 'cuisine'),
    ('swiss', 'swiss', 'cuisine'),
    ('british', 'british', 'cuisine'),
    ('irish', 'irish', 'cuisine'),
    ('scottish', 'scottish', 'cuisine'),
    ('welsh', 'welsh', 'cuisine'),
    ('dutch', 'dutch', 'cuisine'),
    ('belgian', 'belgian', 'cuisine'),
    ('luxembourgish', 'luxembourgish', 'cuisine'),
    ('swedish', 'swedish', 'cuisine'),
    ('norwegian', 'norwegian', 'cuisine'),
    ('danish', 'danish', 'cuisine'),
    ('finnish', 'finnish', 'cuisine'),
    ('icelandic', 'icelandic', 'cuisine'),
    ('scandinavian', 'scandinavian', 'cuisine'),
    ('polish', 'polish', 'cuisine'),
    ('czech', 'czech', 'cuisine'),
    ('slovak', 'slovak', 'cuisine'),
    ('hungarian', 'hungarian', 'cuisine'),
    ('romanian', 'romanian', 'cuisine'),
    ('bulgarian', 'bulgarian', 'cuisine'),
    ('serbian', 'serbian', 'cuisine'),
    ('croatian', 'croatian', 'cuisine'),
    ('bosnian', 'bosnian', 'cuisine'),
    ('slovenian', 'slovenian', 'cuisine'),
    ('albanian', 'albanian', 'cuisine'),
    ('macedonian', 'macedonian', 'cuisine'),
    ('montenegrin', 'montenegrin', 'cuisine'),
    ('russian', 'russian', 'cuisine'),
    ('ukrainian', 'ukrainian', 'cuisine'),
    ('belarusian', 'belarusian', 'cuisine'),
    ('georgian', 'georgian', 'cuisine'),
    ('armenian', 'armenian', 'cuisine'),
    ('azerbaijani', 'azerbaijani', 'cuisine'),
    ('balkan', 'balkan', 'cuisine'),

    -- Middle East & Caucasus
    ('levantine', 'levantine', 'cuisine'),
    ('lebanese', 'lebanese', 'cuisine'),
    ('syrian', 'syrian', 'cuisine'),
    ('palestinian', 'palestinian', 'cuisine'),
    ('israeli', 'israeli', 'cuisine'),
    ('jordanian', 'jordanian', 'cuisine'),
    ('iraqi', 'iraqi', 'cuisine'),
    ('iranian', 'iranian', 'cuisine'),
    ('persian', 'persian', 'cuisine'),
    ('saudi', 'saudi', 'cuisine'),
    ('emirati', 'emirati', 'cuisine'),
    ('yemeni', 'yemeni', 'cuisine'),
    ('omani', 'omani', 'cuisine'),
    ('qatari', 'qatari', 'cuisine'),
    ('kuwaiti', 'kuwaiti', 'cuisine'),

    -- Africa
    ('moroccan', 'moroccan', 'cuisine'),
    ('algerian', 'algerian', 'cuisine'),
    ('tunisian', 'tunisian', 'cuisine'),
    ('libyan', 'libyan', 'cuisine'),
    ('egyptian', 'egyptian', 'cuisine'),
    ('ethiopian', 'ethiopian', 'cuisine'),
    ('eritrean', 'eritrean', 'cuisine'),
    ('somali', 'somali', 'cuisine'),
    ('kenyan', 'kenyan', 'cuisine'),
    ('tanzanian', 'tanzanian', 'cuisine'),
    ('ugandan', 'ugandan', 'cuisine'),
    ('nigerian', 'nigerian', 'cuisine'),
    ('ghanaian', 'ghanaian', 'cuisine'),
    ('senegalese', 'senegalese', 'cuisine'),
    ('ivorian', 'ivorian', 'cuisine'),
    ('malian', 'malian', 'cuisine'),
    ('cameroonian', 'cameroonian', 'cuisine'),
    ('zimbabwean', 'zimbabwean', 'cuisine'),
    ('namibian', 'namibian', 'cuisine'),
    ('angolan', 'angolan', 'cuisine'),
    ('mozambican', 'mozambican', 'cuisine'),

    -- South Asia
    ('indian', 'indian', 'cuisine'),
    ('pakistani', 'pakistani', 'cuisine'),
    ('bangladeshi', 'bangladeshi', 'cuisine'),
    ('nepalese', 'nepalese', 'cuisine'),
    ('bhutanese', 'bhutanese', 'cuisine'),
    ('afghan', 'afghan', 'cuisine'),

    -- East Asia
    ('chinese', 'chinese', 'cuisine'),
    ('cantonese', 'cantonese', 'cuisine'),
    ('sichuan', 'sichuan', 'cuisine'),
    ('hunan', 'hunan', 'cuisine'),
    ('shanghainese', 'shanghainese', 'cuisine'),
    ('taiwanese', 'taiwanese', 'cuisine'),
    ('japanese', 'japanese', 'cuisine'),
    ('okinawan', 'okinawan', 'cuisine'),
    ('korean', 'korean', 'cuisine'),
    ('mongolian', 'mongolian', 'cuisine'),

    -- Southeast Asia
    ('thai', 'thai', 'cuisine'),
    ('vietnamese', 'vietnamese', 'cuisine'),
    ('laotian', 'laotian', 'cuisine'),
    ('cambodian', 'cambodian', 'cuisine'),
    ('malaysian', 'malaysian', 'cuisine'),
    ('indonesian', 'indonesian', 'cuisine'),
    ('singaporean', 'singaporean', 'cuisine'),
    ('filipino', 'filipino', 'cuisine'),
    ('burmese', 'burmese', 'cuisine'),

    -- Central Asia
    ('kazakh', 'kazakh', 'cuisine'),
    ('uzbek', 'uzbek', 'cuisine'),
    ('turkmen', 'turkmen', 'cuisine'),
    ('kyrgyz', 'kyrgyz', 'cuisine'),
    ('tajik', 'tajik', 'cuisine'),

    -- Americas
    ('american', 'american', 'cuisine'),
    ('southern', 'southern', 'cuisine'),
    ('cajun', 'cajun', 'cuisine'),
    ('creole', 'creole', 'cuisine'),
    ('mexican', 'mexican', 'cuisine'),
    ('guatemalan', 'guatemalan', 'cuisine'),
    ('salvadoran', 'salvadoran', 'cuisine'),
    ('honduran', 'honduran', 'cuisine'),
    ('nicaraguan', 'nicaraguan', 'cuisine'),
    ('panamanian', 'panamanian', 'cuisine'),
    ('cuban', 'cuban', 'cuisine'),
    ('dominican', 'dominican', 'cuisine'),
    ('jamaican', 'jamaican', 'cuisine'),
    ('colombian', 'colombian', 'cuisine'),
    ('venezuelan', 'venezuelan', 'cuisine'),
    ('ecuadorian', 'ecuadorian', 'cuisine'),
    ('peruvian', 'peruvian', 'cuisine'),
    ('bolivian', 'bolivian', 'cuisine'),
    ('chilean', 'chilean', 'cuisine'),
    ('argentinian', 'argentinian', 'cuisine'),
    ('uruguayan', 'uruguayan', 'cuisine'),
    ('paraguayan', 'paraguayan', 'cuisine'),
    ('brazilian', 'brazilian', 'cuisine'),

    -- Oceania
    ('australian', 'australian', 'cuisine'),
    ('polynesian', 'polynesian', 'cuisine'),
    ('micronesian', 'micronesian', 'cuisine'),
    ('melanesian', 'melanesian', 'cuisine'),

    -- Global / Modern
    ('asian', 'asian', 'cuisine'),
    ('european', 'european', 'cuisine'),
    ('african', 'african', 'cuisine'),
    ('oceania', 'oceania', 'cuisine'),
    ('mediterranean', 'mediterranean', 'cuisine'),
    ('caribbean', 'caribbean', 'cuisine') on conflict (name, type) do nothing;

-- Continental/Regional parents (top-level hierarchies)
update tags
set parent_id = ( select id from tags where name = 'asian' and type = 'cuisine' )
where name in ('east asian', 'southeast asian', 'south asian', 'central asian')
  and type = 'cuisine';

update tags
set parent_id = ( select id from tags where name = 'european' and type = 'cuisine' )
where name in ('scandinavian', 'eastern european', 'mediterranean')
  and type = 'cuisine';

update tags
set parent_id = ( select id from tags where name = 'african' and type = 'cuisine' )
where name in ('north african', 'west african', 'east african', 'south african')
  and type = 'cuisine';

update tags
set parent_id = ( select id from tags where name = 'north american' and type = 'cuisine' )
where name = 'american'
  and type = 'cuisine';

update tags
set parent_id = ( select id from tags where name = 'south american' and type = 'cuisine' )
where name = 'latin american'
  and type = 'cuisine';

-- Middle Eastern also under Asian (can be standalone or under asian)
update tags
set parent_id = ( select id from tags where name = 'asian' and type = 'cuisine' )
where name = 'middle eastern'
  and type = 'cuisine';

update tags
set parent_id = ( select id from tags where name = 'caribbean' and type = 'cuisine' )
where name in ('cuban', 'puerto rican', 'dominican', 'jamaican')
  and type = 'cuisine';


-- ============================================================================
-- COURSE TAGS (all single-word canonical tags)
-- ============================================================================

-- Seed course tags (all canonical with canonical_id = name)
insert into tags (name, canonical_id, type)
values ('appetizer', 'appetizer', 'course'),
       ('starter', 'starter', 'course'),
       ('main', 'main', 'course'),
       ('side', 'side', 'course'),
       ('dessert', 'dessert', 'course') on conflict (name, type) do nothing;
