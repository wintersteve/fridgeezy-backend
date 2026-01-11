-- Seed data for units table

-- Insert base units first (they have no base_unit_id)
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    -- Base units (conversion_factor = 1, base_unit_id = null initially)
    ('gram', 'g', 'metric', 'weight', null, 1),
    ('milliliter', 'ml', 'metric', 'volume', null, 1),
    ('piece', 'pc', 'universal', 'count', null, 1);

-- Update base units to reference themselves
update units set base_unit_id = id where base_unit_id is null;

-- Insert metric weight units
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    ('kilogram', 'kg', 'metric', 'weight', (select id from units where abbreviation = 'g'), 1000),
    ('milligram', 'mg', 'metric', 'weight', (select id from units where abbreviation = 'g'), 0.001);

-- Insert imperial weight units
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    ('ounce', 'oz', 'imperial', 'weight', (select id from units where abbreviation = 'g'), 28.3495),
    ('pound', 'lb', 'imperial', 'weight', (select id from units where abbreviation = 'g'), 453.592);

-- Insert metric volume units
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    ('liter', 'l', 'metric', 'volume', (select id from units where abbreviation = 'ml'), 1000),
    ('centiliter', 'cl', 'metric', 'volume', (select id from units where abbreviation = 'ml'), 10);

-- Insert imperial volume units
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    ('teaspoon', 'tsp', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 4.92892),
    ('tablespoon', 'tbsp', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 14.7868),
    ('fluid ounce', 'fl oz', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 29.5735),
    ('cup', 'cup', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 236.588),
    ('pint', 'pt', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 473.176),
    ('quart', 'qt', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 946.353),
    ('gallon', 'gal', 'imperial', 'volume', (select id from units where abbreviation = 'ml'), 3785.41);

-- Insert count units
insert into units (name, abbreviation, system, type, base_unit_id, conversion_factor)
values
    ('clove', 'clove', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('slice', 'slice', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('bunch', 'bunch', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('pinch', 'pinch', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('dash', 'dash', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('sprig', 'sprig', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('head', 'head', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('can', 'can', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1),
    ('package', 'pkg', 'universal', 'count', (select id from units where abbreviation = 'pc'), 1);
