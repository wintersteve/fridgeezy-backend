-- ============================================================================
-- CUISINE TAGS (strict 3-level hierarchy: Root → Middle → Leaf)
-- ============================================================================

-- ============================================================================
-- LEVEL 1: ROOT TAGS (Continental)
-- ============================================================================
insert into tags (name, canonical_id, type)
values ('asian', 'asian', 'cuisine'),
       ('european', 'european', 'cuisine'),
       ('african', 'african', 'cuisine'),
       ('americas', 'americas', 'cuisine'),
       ('oceania', 'oceania', 'cuisine') on conflict (name, type) do nothing;

-- ============================================================================
-- LEVEL 2: MIDDLE TAGS (Regional groupings - multi-word)
-- ============================================================================
insert into tags (name, canonical_id, type)
values
    -- Asian regions
    ('east asian', 'east_asian', 'cuisine'),
    ('southeast asian', 'southeast_asian', 'cuisine'),
    ('south asian', 'south_asian', 'cuisine'),
    ('central asian', 'central_asian', 'cuisine'),
    ('middle eastern', 'middle_eastern', 'cuisine'),

    -- European regions
    ('eastern european', 'eastern_european', 'cuisine'),
    ('western european', 'western_european', 'cuisine'),
    ('british isles', 'british_isles', 'cuisine'),
    ('central european', 'central_european', 'cuisine'),

    -- African regions
    ('north african', 'north_african', 'cuisine'),
    ('west african', 'west_african', 'cuisine'),
    ('east african', 'east_african', 'cuisine'),
    ('south african', 'south_african', 'cuisine'),
    ('central african', 'central_african', 'cuisine'),

    -- Americas regions
    ('north american', 'north_american', 'cuisine'),
    ('central american', 'central_american', 'cuisine'),
    ('south american', 'south_american', 'cuisine'),

    -- Pacific regions
    ('pacific islands', 'pacific_islands', 'cuisine') on conflict (name, type) do nothing;

-- LEVEL 2: MIDDLE TAGS (Regional groupings - single-word)
insert into tags (name, canonical_id, type)
values ('mediterranean', 'mediterranean', 'cuisine'),
       ('scandinavian', 'scandinavian', 'cuisine'),
       ('balkan', 'balkan', 'cuisine'),
       ('caucasus', 'caucasus', 'cuisine'),
       ('caribbean', 'caribbean', 'cuisine'),
       ('australasian', 'australasian', 'cuisine') on conflict (name, type) do nothing;

-- ============================================================================
-- LEVEL 3: LEAF TAGS (Specific cuisines - multi-word)
-- ============================================================================
insert into tags (name, canonical_id, type)
values ('sri lankan', 'sri_lankan', 'cuisine'),
       ('north korean', 'north_korean', 'cuisine'),
       ('tex mex', 'tex_mex', 'cuisine'),
       ('costa rican', 'costa_rican', 'cuisine'),
       ('puerto rican', 'puerto_rican', 'cuisine'),
       ('new zealand', 'new_zealand', 'cuisine'),
       ('pacific islander', 'pacific_islander', 'cuisine') on conflict (name, type) do nothing;

-- LEVEL 3: LEAF TAGS (Specific cuisines - single-word)
insert into tags (name, canonical_id, type)
values
    -- Mediterranean
    ('italian', 'italian', 'cuisine'),
    ('greek', 'greek', 'cuisine'),
    ('spanish', 'spanish', 'cuisine'),
    ('portuguese', 'portuguese', 'cuisine'),
    ('turkish', 'turkish', 'cuisine'),

    -- Western European
    ('french', 'french', 'cuisine'),
    ('german', 'german', 'cuisine'),
    ('austrian', 'austrian', 'cuisine'),
    ('swiss', 'swiss', 'cuisine'),
    ('dutch', 'dutch', 'cuisine'),
    ('belgian', 'belgian', 'cuisine'),
    ('luxembourgish', 'luxembourgish', 'cuisine'),

    -- British Isles
    ('british', 'british', 'cuisine'),
    ('irish', 'irish', 'cuisine'),
    ('scottish', 'scottish', 'cuisine'),
    ('welsh', 'welsh', 'cuisine'),

    -- Scandinavian
    ('swedish', 'swedish', 'cuisine'),
    ('norwegian', 'norwegian', 'cuisine'),
    ('danish', 'danish', 'cuisine'),
    ('finnish', 'finnish', 'cuisine'),
    ('icelandic', 'icelandic', 'cuisine'),

    -- Eastern European
    ('polish', 'polish', 'cuisine'),
    ('czech', 'czech', 'cuisine'),
    ('slovak', 'slovak', 'cuisine'),
    ('hungarian', 'hungarian', 'cuisine'),
    ('romanian', 'romanian', 'cuisine'),
    ('bulgarian', 'bulgarian', 'cuisine'),
    ('russian', 'russian', 'cuisine'),
    ('ukrainian', 'ukrainian', 'cuisine'),
    ('belarusian', 'belarusian', 'cuisine'),

    -- Balkan
    ('serbian', 'serbian', 'cuisine'),
    ('croatian', 'croatian', 'cuisine'),
    ('bosnian', 'bosnian', 'cuisine'),
    ('slovenian', 'slovenian', 'cuisine'),
    ('albanian', 'albanian', 'cuisine'),
    ('macedonian', 'macedonian', 'cuisine'),
    ('montenegrin', 'montenegrin', 'cuisine'),

    -- Caucasus
    ('georgian', 'georgian', 'cuisine'),
    ('armenian', 'armenian', 'cuisine'),
    ('azerbaijani', 'azerbaijani', 'cuisine'),

    -- Middle Eastern
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

    -- North African
    ('moroccan', 'moroccan', 'cuisine'),
    ('algerian', 'algerian', 'cuisine'),
    ('tunisian', 'tunisian', 'cuisine'),
    ('libyan', 'libyan', 'cuisine'),
    ('egyptian', 'egyptian', 'cuisine'),

    -- West African
    ('nigerian', 'nigerian', 'cuisine'),
    ('ghanaian', 'ghanaian', 'cuisine'),
    ('senegalese', 'senegalese', 'cuisine'),
    ('ivorian', 'ivorian', 'cuisine'),
    ('malian', 'malian', 'cuisine'),

    -- East African
    ('ethiopian', 'ethiopian', 'cuisine'),
    ('eritrean', 'eritrean', 'cuisine'),
    ('somali', 'somali', 'cuisine'),
    ('kenyan', 'kenyan', 'cuisine'),
    ('tanzanian', 'tanzanian', 'cuisine'),
    ('ugandan', 'ugandan', 'cuisine'),

    -- South African region
    ('zimbabwean', 'zimbabwean', 'cuisine'),
    ('namibian', 'namibian', 'cuisine'),

    -- Central African
    ('cameroonian', 'cameroonian', 'cuisine'),
    ('angolan', 'angolan', 'cuisine'),
    ('mozambican', 'mozambican', 'cuisine'),

    -- South Asian
    ('indian', 'indian', 'cuisine'),
    ('pakistani', 'pakistani', 'cuisine'),
    ('bangladeshi', 'bangladeshi', 'cuisine'),
    ('nepalese', 'nepalese', 'cuisine'),
    ('bhutanese', 'bhutanese', 'cuisine'),
    ('afghan', 'afghan', 'cuisine'),

    -- East Asian
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

    -- Southeast Asian
    ('thai', 'thai', 'cuisine'),
    ('vietnamese', 'vietnamese', 'cuisine'),
    ('laotian', 'laotian', 'cuisine'),
    ('cambodian', 'cambodian', 'cuisine'),
    ('malaysian', 'malaysian', 'cuisine'),
    ('indonesian', 'indonesian', 'cuisine'),
    ('singaporean', 'singaporean', 'cuisine'),
    ('filipino', 'filipino', 'cuisine'),
    ('burmese', 'burmese', 'cuisine'),

    -- Central Asian
    ('kazakh', 'kazakh', 'cuisine'),
    ('uzbek', 'uzbek', 'cuisine'),
    ('turkmen', 'turkmen', 'cuisine'),
    ('kyrgyz', 'kyrgyz', 'cuisine'),
    ('tajik', 'tajik', 'cuisine'),

    -- North American
    ('american', 'american', 'cuisine'),
    ('canadian', 'canadian', 'cuisine'),
    ('southern', 'southern', 'cuisine'),
    ('cajun', 'cajun', 'cuisine'),
    ('creole', 'creole', 'cuisine'),

    -- Central American
    ('mexican', 'mexican', 'cuisine'),
    ('guatemalan', 'guatemalan', 'cuisine'),
    ('salvadoran', 'salvadoran', 'cuisine'),
    ('honduran', 'honduran', 'cuisine'),
    ('nicaraguan', 'nicaraguan', 'cuisine'),
    ('panamanian', 'panamanian', 'cuisine'),

    -- Caribbean
    ('cuban', 'cuban', 'cuisine'),
    ('dominican', 'dominican', 'cuisine'),
    ('jamaican', 'jamaican', 'cuisine'),

    -- South American
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

    -- Australasian
    ('australian', 'australian', 'cuisine'),

    -- Pacific Islands
    ('polynesian', 'polynesian', 'cuisine'),
    ('micronesian', 'micronesian', 'cuisine'),
    ('melanesian', 'melanesian', 'cuisine') on conflict (name, type) do nothing;

-- ============================================================================
-- LEVEL 2 → LEVEL 1: Assign middle-level tags to root parents
-- ============================================================================

-- Asian regions → asian
update tags
set parent_id = ( select id from tags where name = 'asian' and type = 'cuisine' )
where name in ('east asian', 'southeast asian', 'south asian', 'central asian', 'middle eastern')
  and type = 'cuisine';

-- European regions → european
update tags
set parent_id = ( select id from tags where name = 'european' and type = 'cuisine' )
where name in ('mediterranean', 'scandinavian', 'eastern european', 'western european', 'british isles',
               'balkan', 'caucasus', 'central european')
  and type = 'cuisine';

-- African regions → african
update tags
set parent_id = ( select id from tags where name = 'african' and type = 'cuisine' )
where name in ('north african', 'west african', 'east african', 'south african', 'central african')
  and type = 'cuisine';

-- Americas regions → americas
update tags
set parent_id = ( select id from tags where name = 'americas' and type = 'cuisine' )
where name in ('north american', 'central american', 'south american', 'caribbean')
  and type = 'cuisine';

-- Oceania regions → oceania
update tags
set parent_id = ( select id from tags where name = 'oceania' and type = 'cuisine' )
where name in ('australasian', 'pacific islands')
  and type = 'cuisine';

-- ============================================================================
-- LEVEL 3 → LEVEL 2: Assign leaf-level tags to middle parents
-- ============================================================================

-- Mediterranean cuisines
update tags
set parent_id = ( select id from tags where name = 'mediterranean' and type = 'cuisine' )
where name in ('italian', 'greek', 'spanish', 'portuguese', 'turkish')
  and type = 'cuisine';

-- Western European cuisines
update tags
set parent_id = ( select id from tags where name = 'western european' and type = 'cuisine' )
where name in ('french', 'german', 'austrian', 'swiss', 'dutch', 'belgian', 'luxembourgish')
  and type = 'cuisine';

-- British Isles cuisines
update tags
set parent_id = ( select id from tags where name = 'british isles' and type = 'cuisine' )
where name in ('british', 'irish', 'scottish', 'welsh')
  and type = 'cuisine';

-- Scandinavian cuisines
update tags
set parent_id = ( select id from tags where name = 'scandinavian' and type = 'cuisine' )
where name in ('swedish', 'norwegian', 'danish', 'finnish', 'icelandic')
  and type = 'cuisine';

-- Eastern European cuisines
update tags
set parent_id = ( select id from tags where name = 'eastern european' and type = 'cuisine' )
where name in ('polish', 'czech', 'slovak', 'hungarian', 'romanian', 'bulgarian', 'russian', 'ukrainian',
               'belarusian')
  and type = 'cuisine';

-- Balkan cuisines
update tags
set parent_id = ( select id from tags where name = 'balkan' and type = 'cuisine' )
where name in ('serbian', 'croatian', 'bosnian', 'slovenian', 'albanian', 'macedonian', 'montenegrin')
  and type = 'cuisine';

-- Caucasus cuisines
update tags
set parent_id = ( select id from tags where name = 'caucasus' and type = 'cuisine' )
where name in ('georgian', 'armenian', 'azerbaijani')
  and type = 'cuisine';

-- Middle Eastern cuisines
update tags
set parent_id = ( select id from tags where name = 'middle eastern' and type = 'cuisine' )
where name in ('levantine', 'lebanese', 'syrian', 'palestinian', 'israeli', 'jordanian', 'iraqi', 'iranian',
               'persian', 'saudi', 'emirati', 'yemeni', 'omani', 'qatari', 'kuwaiti')
  and type = 'cuisine';

-- North African cuisines
update tags
set parent_id = ( select id from tags where name = 'north african' and type = 'cuisine' )
where name in ('moroccan', 'algerian', 'tunisian', 'libyan', 'egyptian')
  and type = 'cuisine';

-- West African cuisines
update tags
set parent_id = ( select id from tags where name = 'west african' and type = 'cuisine' )
where name in ('nigerian', 'ghanaian', 'senegalese', 'ivorian', 'malian')
  and type = 'cuisine';

-- East African cuisines
update tags
set parent_id = ( select id from tags where name = 'east african' and type = 'cuisine' )
where name in ('ethiopian', 'eritrean', 'somali', 'kenyan', 'tanzanian', 'ugandan')
  and type = 'cuisine';

-- South African cuisines
update tags
set parent_id = ( select id from tags where name = 'south african' and type = 'cuisine' )
where name in ('zimbabwean', 'namibian')
  and type = 'cuisine';

-- Central African cuisines
update tags
set parent_id = ( select id from tags where name = 'central african' and type = 'cuisine' )
where name in ('cameroonian', 'angolan', 'mozambican')
  and type = 'cuisine';

-- South Asian cuisines
update tags
set parent_id = ( select id from tags where name = 'south asian' and type = 'cuisine' )
where name in ('indian', 'pakistani', 'bangladeshi', 'nepalese', 'bhutanese', 'sri lankan', 'afghan')
  and type = 'cuisine';

-- East Asian cuisines
update tags
set parent_id = ( select id from tags where name = 'east asian' and type = 'cuisine' )
where name in ('chinese', 'cantonese', 'sichuan', 'hunan', 'shanghainese', 'taiwanese', 'japanese', 'okinawan',
               'korean', 'north korean', 'mongolian')
  and type = 'cuisine';

-- Southeast Asian cuisines
update tags
set parent_id = ( select id from tags where name = 'southeast asian' and type = 'cuisine' )
where name in ('thai', 'vietnamese', 'laotian', 'cambodian', 'malaysian', 'indonesian', 'singaporean', 'filipino',
               'burmese')
  and type = 'cuisine';

-- Central Asian cuisines
update tags
set parent_id = ( select id from tags where name = 'central asian' and type = 'cuisine' )
where name in ('kazakh', 'uzbek', 'turkmen', 'kyrgyz', 'tajik')
  and type = 'cuisine';

-- North American cuisines
update tags
set parent_id = ( select id from tags where name = 'north american' and type = 'cuisine' )
where name in ('american', 'canadian', 'southern', 'cajun', 'creole', 'tex mex')
  and type = 'cuisine';

-- Central American cuisines
update tags
set parent_id = ( select id from tags where name = 'central american' and type = 'cuisine' )
where name in ('mexican', 'guatemalan', 'salvadoran', 'honduran', 'nicaraguan', 'costa rican', 'panamanian')
  and type = 'cuisine';

-- Caribbean cuisines
update tags
set parent_id = ( select id from tags where name = 'caribbean' and type = 'cuisine' )
where name in ('cuban', 'puerto rican', 'dominican', 'jamaican')
  and type = 'cuisine';

-- South American cuisines
update tags
set parent_id = ( select id from tags where name = 'south american' and type = 'cuisine' )
where name in ('colombian', 'venezuelan', 'ecuadorian', 'peruvian', 'bolivian', 'chilean', 'argentinian',
               'uruguayan', 'paraguayan', 'brazilian')
  and type = 'cuisine';

-- Australasian cuisines
update tags
set parent_id = ( select id from tags where name = 'australasian' and type = 'cuisine' )
where name in ('australian', 'new zealand')
  and type = 'cuisine';

-- Pacific Islands cuisines
update tags
set parent_id = ( select id from tags where name = 'pacific islands' and type = 'cuisine' )
where name in ('polynesian', 'micronesian', 'melanesian', 'pacific islander')
  and type = 'cuisine';
