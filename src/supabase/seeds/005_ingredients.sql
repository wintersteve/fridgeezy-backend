-- Seed essential ingredients covering 99% of world cuisine
-- Organized by category with parent-child relationships

-- Helper function to get category ID by name
DO
$$
declare
cat_meat UUID;
    cat_poultry
UUID;
    cat_seafood
UUID;
    cat_egg
UUID;
    cat_dairy
UUID;
    cat_cheese
UUID;
    cat_vegetable
UUID;
    cat_fruit
UUID;
    cat_mushroom
UUID;
    cat_grain
UUID;
    cat_rice
UUID;
    cat_pasta
UUID;
    cat_noodle
UUID;
    cat_bread
UUID;
    cat_flour
UUID;
    cat_legume
UUID;
    cat_nut
UUID;
    cat_seed
UUID;
    cat_herb
UUID;
    cat_spice
UUID;
    cat_seasoning
UUID;
    cat_oil
UUID;
    cat_fat
UUID;
    cat_condiment
UUID;
    cat_sauce
UUID;
    cat_stock
UUID;
    cat_vinegar
UUID;
    cat_sweetener
UUID;
    cat_baking
UUID;
    cat_alcohol
UUID;
    cat_beverage
UUID;
begin
    -- Get all category IDs
select id
into cat_meat
from categories
where name = 'meat';
select id
into cat_poultry
from categories
where name = 'poultry';
select id
into cat_seafood
from categories
where name = 'seafood';
select id
into cat_egg
from categories
where name = 'egg';
select id
into cat_dairy
from categories
where name = 'dairy';
select id
into cat_cheese
from categories
where name = 'cheese';
select id
into cat_vegetable
from categories
where name = 'vegetable';
select id
into cat_fruit
from categories
where name = 'fruit';
select id
into cat_mushroom
from categories
where name = 'mushroom';
select id
into cat_grain
from categories
where name = 'grain';
select id
into cat_rice
from categories
where name = 'rice';
select id
into cat_pasta
from categories
where name = 'pasta';
select id
into cat_noodle
from categories
where name = 'noodle';
select id
into cat_bread
from categories
where name = 'bread';
select id
into cat_flour
from categories
where name = 'flour';
select id
into cat_legume
from categories
where name = 'legume';
select id
into cat_nut
from categories
where name = 'nut';
select id
into cat_seed
from categories
where name = 'seed';
select id
into cat_herb
from categories
where name = 'herb';
select id
into cat_spice
from categories
where name = 'spice';
select id
into cat_seasoning
from categories
where name = 'seasoning';
select id
into cat_oil
from categories
where name = 'oil';
select id
into cat_fat
from categories
where name = 'fat';
select id
into cat_condiment
from categories
where name = 'condiment';
select id
into cat_sauce
from categories
where name = 'sauce';
select id
into cat_stock
from categories
where name = 'stock';
select id
into cat_vinegar
from categories
where name = 'vinegar';
select id
into cat_sweetener
from categories
where name = 'sweetener';
select id
into cat_baking
from categories
where name = 'baking';
select id
into cat_alcohol
from categories
where name = 'alcohol';
select id
into cat_beverage
from categories
where name = 'beverage';

-- ========== PROTEINS ==========

-- MEAT (Red Meats)
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('beef', cat_meat, 'Red meat from cattle', '3-5 days refrigerated, 6-12 months frozen',
        'Store in coldest part of refrigerator or freeze'),
       ('ground_beef', cat_meat, 'Minced beef', '1-2 days refrigerated, 3-4 months frozen',
        'Use quickly or freeze immediately'),
       ('beef_chuck', cat_meat, 'Shoulder cut, ideal for slow cooking', '3-5 days refrigerated, 6-12 months frozen',
        'Store wrapped in coldest part of fridge'),
       ('beef_sirloin', cat_meat, 'Tender cut from the back', '3-5 days refrigerated, 6-12 months frozen',
        'Store wrapped in coldest part of fridge'),
       ('pork', cat_meat, 'Meat from pigs', '3-5 days refrigerated, 6-12 months frozen',
        'Store in coldest part of refrigerator'),
       ('pork_chop', cat_meat, 'Cut from pork loin', '3-5 days refrigerated, 6-12 months frozen',
        'Store wrapped in fridge'),
       ('ground_pork', cat_meat, 'Minced pork', '1-2 days refrigerated, 3-4 months frozen', 'Use quickly or freeze'),
       ('bacon', cat_meat, 'Cured pork belly', '1 week refrigerated, 1 month frozen', 'Keep refrigerated in package'),
       ('lamb', cat_meat, 'Meat from young sheep', '3-5 days refrigerated, 6-12 months frozen',
        'Store in coldest part of refrigerator'),
       ('leg_of_lamb', cat_meat, 'Leg cut of lamb', '3-5 days refrigerated, 6-12 months frozen',
        'Store wrapped in fridge'),
       ('veal', cat_meat, 'Meat from young cattle', '3-5 days refrigerated, 6-12 months frozen',
        'Store in coldest part of refrigerator') on CONFLICT (name) DO NOTHING;

-- POULTRY
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('chicken', cat_poultry, 'Domestic fowl', '1-2 days refrigerated, 9-12 months frozen',
        'Store in coldest part of fridge'),
       ('chicken_breast', cat_poultry, 'Boneless breast meat', '1-2 days refrigerated, 9 months frozen',
        'Store wrapped or freeze immediately'),
       ('chicken_thigh', cat_poultry, 'Dark meat from leg', '1-2 days refrigerated, 9 months frozen',
        'Store wrapped in fridge'),
       ('whole_chicken', cat_poultry, 'Entire chicken', '1-2 days refrigerated, 12 months frozen',
        'Store in coldest part of fridge'),
       ('ground_chicken', cat_poultry, 'Minced chicken', '1-2 days refrigerated, 3-4 months frozen',
        'Use quickly or freeze'),
       ('turkey', cat_poultry, 'Large domestic fowl', '1-2 days refrigerated, 12 months frozen',
        'Store in coldest part of fridge'),
       ('turkey_breast', cat_poultry, 'Breast meat from turkey', '1-2 days refrigerated, 9 months frozen',
        'Store wrapped or freeze'),
       ('duck', cat_poultry, 'Waterfowl with rich flavor', '1-2 days refrigerated, 6 months frozen',
        'Store in coldest part of fridge') on CONFLICT (name) DO NOTHING;

-- SEAFOOD
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
-- White & lean fish
('haddock', cat_seafood, 'Mild white fish similar to cod', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),
('pollock', cat_seafood, 'White fish used in fillets and surimi', '1-2 days refrigerated, 3 months frozen',
 'Keep very cold'),
('halibut', cat_seafood, 'Large flatfish with firm white flesh', '1-2 days refrigerated, 3 months frozen',
 'Store on ice'),
('sole', cat_seafood, 'Delicate flatfish', '1-2 days refrigerated, 3 months frozen', 'Keep cold and dry'),
('flounder', cat_seafood, 'Mild flatfish', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),
('snapper', cat_seafood, 'Firm white reef fish', '1-2 days refrigerated, 3 months frozen', 'Keep very cold'),
('grouper', cat_seafood, 'Firm white fish popular in tropics', '1-2 days refrigerated, 3 months frozen',
 'Store on ice'),
('sea_bass', cat_seafood, 'Mild, flaky white fish', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),
('branzino', cat_seafood, 'Mediterranean sea bass', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),

-- Oily & flavorful fish
('mackerel', cat_seafood, 'Oily fish with strong flavor', '1 day refrigerated, 2-3 months frozen', 'Store very cold'),
('sardine', cat_seafood, 'Small oily fish', '1 day refrigerated, 2-3 months frozen', 'Keep iced'),
('anchovy', cat_seafood, 'Small oily fish often cured', '1 day refrigerated, 2-3 months frozen', 'Store cold or cured'),
('herring', cat_seafood, 'Oily fish used fresh or pickled', '1-2 days refrigerated, 3 months frozen', 'Keep very cold'),
('trout', cat_seafood, 'Freshwater fish similar to salmon', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),
('arctic char', cat_seafood, 'Salmon-like cold-water fish', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),

-- Tuna & billfish
('yellowfin_tuna', cat_seafood, 'Lean tuna variety', '1-2 days refrigerated, 3 months frozen', 'Store very cold'),
('bluefin_tuna', cat_seafood, 'Highly prized fatty tuna', '1-2 days refrigerated, 3 months frozen',
 'Store near freezing'),
('albacore_tuna', cat_seafood, 'White-meat tuna', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),
('swordfish', cat_seafood, 'Firm, steak-like fish', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),
('marlin', cat_seafood, 'Large game fish', '1-2 days refrigerated, 3 months frozen', 'Keep very cold'),

-- Shellfish – bivalves
('mussel', cat_seafood, 'Small bivalve shellfish', '1-2 days refrigerated', 'Keep alive, do not seal'),
('clam', cat_seafood, 'Bivalve shellfish', '1-2 days refrigerated', 'Store alive, damp cloth'),
('oyster', cat_seafood, 'Briny bivalve shellfish', '1-2 days refrigerated', 'Keep alive, shell down'),
('cockle', cat_seafood, 'Small edible clam', '1-2 days refrigerated', 'Store alive and cold'),

-- Shellfish – cephalopods
('squid', cat_seafood, 'Cephalopod with firm flesh', '1-2 days refrigerated, 3 months frozen', 'Keep very cold'),
('calamari', cat_seafood, 'Culinary term for squid', '1-2 days refrigerated, 3 months frozen', 'Store cold'),
('octopus', cat_seafood, 'Large cephalopod', '1-2 days refrigerated, 3 months frozen', 'Freeze to tenderize'),
('cuttlefish', cat_seafood, 'Cephalopod with mild flavor', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),

-- Shellfish – crustaceans
('prawn', cat_seafood, 'Large shrimp variety', '1-2 days refrigerated, 3-6 months frozen', 'Keep frozen'),
('langoustine', cat_seafood, 'Norway lobster', '1 day refrigerated, 3 months frozen', 'Keep very cold'),
('crawfish', cat_seafood, 'Freshwater crustacean', '1 day refrigerated, 3 months frozen', 'Cook promptly'),
('crayfish', cat_seafood, 'Freshwater lobster-like shellfish', '1 day refrigerated, 3 months frozen', 'Keep cold'),
('blue_crab', cat_seafood, 'Crab species common in Americas', '1 day refrigerated, 3 months frozen', 'Cook quickly'),
('king_crab', cat_seafood, 'Large crab with sweet meat', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),
('snow_crab', cat_seafood, 'Crab with delicate meat', '1-2 days refrigerated, 3 months frozen', 'Store cold'),

-- Specialty & regional seafood
('eel', cat_seafood, 'Oily elongated fish', '1-2 days refrigerated, 3 months frozen', 'Keep chilled'),
('conger_eel', cat_seafood, 'Large eel used in European cuisine', '1-2 days refrigerated, 3 months frozen',
 'Store on ice'),
('monkfish', cat_seafood, 'Firm fish with lobster-like texture', '1-2 days refrigerated, 3 months frozen',
 'Keep very cold'),
('tilefish', cat_seafood, 'Firm white fish', '1-2 days refrigerated, 3 months frozen', 'Store chilled'),
('milkfish', cat_seafood, 'Popular Southeast Asian fish', '1-2 days refrigerated, 3 months frozen', 'Keep cold'),
('barramundi', cat_seafood, 'Mild Australian sea bass', '1-2 days refrigerated, 3 months frozen', 'Store on ice'),

-- Roe & preserved
('fish_roe', cat_seafood, 'Salted fish eggs', '3-5 days refrigerated', 'Keep sealed and cold'),
('caviar', cat_seafood, 'Salt-cured sturgeon roe', '1-2 weeks refrigerated', 'Keep unopened and cold'),
('bottarga', cat_seafood, 'Cured fish roe', 'Several months refrigerated', 'Wrap tightly'),

-- Miscellaneous
('sea_urchin', cat_seafood, 'Edible gonads (uni)', '1-2 days refrigerated', 'Keep very cold'),
('abalone', cat_seafood, 'Edible sea snail', '1-2 days refrigerated', 'Keep alive and cold'),
('whelk', cat_seafood, 'Sea snail', '1-2 days refrigerated', 'Store chilled') on CONFLICT (name) DO NOTHING;

-- EGGS & DAIRY
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('egg', cat_egg, 'Chicken egg', '3-5 weeks refrigerated', 'Store in carton in fridge'),
       ('milk', cat_dairy, 'Dairy milk', '5-7 days refrigerated', 'Keep refrigerated, check date'),
       ('heavy_cream', cat_dairy, 'High-fat cream', '1 week refrigerated', 'Keep cold, shake before use'),
       ('sour_cream', cat_dairy, 'Cultured cream', '2-3 weeks refrigerated', 'Keep sealed and refrigerated'),
       ('butter', cat_fat, 'Churned cream fat', '1-3 months refrigerated', 'Keep wrapped in fridge'),
       ('yogurt', cat_dairy, 'Cultured milk', '1-2 weeks refrigerated', 'Keep sealed and cold'),
       ('cream_cheese', cat_cheese, 'Soft spreadable cheese', '2 weeks refrigerated',
        'Keep wrapped and cold') on CONFLICT (name) DO NOTHING;

-- CHEESE
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('cheddar', cat_cheese, 'Sharp aged cheese', '3-4 weeks refrigerated', 'Wrap tightly to prevent drying'),
       ('mozzarella', cat_cheese, 'Mild Italian cheese', '1 week refrigerated', 'Keep in liquid or wrapped'),
       ('parmesan', cat_cheese, 'Hard aged Italian cheese', '6-12 months refrigerated', 'Wrap tightly, grate fresh'),
       ('feta', cat_cheese, 'Brined Greek cheese', '1 week refrigerated', 'Store in brine'),
       ('goat_cheese', cat_cheese, 'Soft tangy cheese', '1-2 weeks refrigerated', 'Keep wrapped and cold'),
       ('swiss', cat_cheese, 'Holey Alpine cheese', '3-4 weeks refrigerated',
        'Wrap tightly') on CONFLICT (name) DO NOTHING;

-- ========== VEGETABLES ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Aromatics (Essential)
    ('onion', cat_vegetable, 'Pungent bulb vegetable', '1-2 months', 'Store in cool, dark, dry place'),
    ('red_onion', cat_vegetable, 'Milder purple onion', '1-2 months', 'Store in cool, dry place'),
    ('shallot', cat_vegetable, 'Small mild onion', '1 month', 'Store in cool, dry place'),
    ('garlic', cat_vegetable, 'Aromatic bulb', '3-6 months', 'Store in cool, dark, dry place'),
    ('ginger', cat_vegetable, 'Spicy rhizome', '1-3 weeks refrigerated', 'Refrigerate unpeeled or freeze'),
    ('scallion', cat_vegetable, 'Green onion', '1 week refrigerated', 'Wrap in damp towel in fridge'),

    -- Tomatoes & Peppers
    ('tomato', cat_vegetable, 'Red fruit used as vegetable', '1 week at room temp', 'Store at room temperature'),
    ('cherry_tomato', cat_vegetable, 'Small sweet tomato', '1 week', 'Room temperature for best flavor'),
    ('bell_pepper', cat_vegetable, 'Sweet pepper', '1 week refrigerated', 'Store in crisper drawer'),
    ('red_bell_pepper', cat_vegetable, 'Sweet red pepper', '1 week refrigerated', 'Store in crisper'),
    ('jalapeno', cat_vegetable, 'Medium-hot chili', '1 week refrigerated', 'Store in crisper'),
    ('chili_pepper', cat_vegetable, 'Hot pepper', '1 week refrigerated', 'Store in crisper or freeze'),

    -- Root Vegetables
    ('potato', cat_vegetable, 'Starchy tuber', '2-3 months', 'Store in cool, dark, dry place'),
    ('sweet_potato', cat_vegetable, 'Sweet orange tuber', '2-3 weeks', 'Store in cool, dark place'),
    ('carrot', cat_vegetable, 'Orange root vegetable', '3-4 weeks refrigerated', 'Store in crisper drawer'),
    ('beet', cat_vegetable, 'Sweet red root', '2-4 weeks refrigerated', 'Remove greens, store in crisper'),
    ('radish', cat_vegetable, 'Crisp peppery root', '1-2 weeks refrigerated', 'Store in crisper'),
    ('turnip', cat_vegetable, 'White root vegetable', '2 weeks refrigerated', 'Store in crisper'),

    -- Stalks & Greens
    ('celery', cat_vegetable, 'Crunchy stalk', '2 weeks refrigerated', 'Wrap in foil, store in crisper'),
    ('spinach', cat_vegetable, 'Leafy green', '1 week refrigerated', 'Store in crisper, keep dry'),
    ('lettuce', cat_vegetable, 'Salad green', '1 week refrigerated', 'Store in crisper'),
    ('kale', cat_vegetable, 'Hearty leafy green', '1 week refrigerated', 'Store in crisper'),
    ('cabbage', cat_vegetable, 'Dense leafy vegetable', '2 weeks refrigerated', 'Store in crisper'),
    ('bok_choy', cat_vegetable, 'Chinese cabbage', '3-4 days refrigerated', 'Store in crisper'),
    ('arugula', cat_vegetable, 'Peppery salad green', '3-5 days refrigerated', 'Store in crisper, keep dry'),

    -- Squashes & Gourds
    ('zucchini', cat_vegetable, 'Green summer squash', '1 week refrigerated', 'Store in crisper'),
    ('cucumber', cat_vegetable, 'Cool green vegetable', '1 week refrigerated', 'Store in crisper'),
    ('eggplant', cat_vegetable, 'Purple nightshade', '1 week', 'Store in cool place, not too cold'),
    ('butternut_squash', cat_vegetable, 'Sweet winter squash', '1-3 months', 'Store in cool, dry place'),

    -- Brassicas
    ('broccoli', cat_vegetable, 'Green cruciferous vegetable', '1 week refrigerated', 'Store in crisper'),
    ('cauliflower', cat_vegetable, 'White cruciferous vegetable', '1 week refrigerated', 'Store in crisper'),
    ('brussels_sprout', cat_vegetable, 'Small cabbage-like vegetable', '1 week refrigerated', 'Store in crisper'),

    -- Other Vegetables
    ('asparagus', cat_vegetable, 'Green spear vegetable', '3-4 days refrigerated', 'Store upright in water'),
    ('green_bean', cat_vegetable, 'Crisp pod vegetable', '1 week refrigerated', 'Store in crisper'),
    ('pea', cat_vegetable, 'Sweet pod vegetable', '3-5 days refrigerated', 'Store in crisper'),
    ('corn', cat_vegetable, 'Sweet kernel vegetable', '3-5 days refrigerated', 'Keep in husk, refrigerate'),
    ('leek', cat_vegetable, 'Mild onion relative', '1-2 weeks refrigerated', 'Store in crisper'),
    ('fennel', cat_vegetable, 'Anise-flavored bulb', '1 week refrigerated',
     'Store in crisper') on CONFLICT (name) DO NOTHING;

-- MUSHROOMS
insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('mushroom', cat_mushroom, 'Edible fungus', '5-7 days refrigerated', 'Store in paper bag in fridge'),
       ('button_mushroom', cat_mushroom, 'Common white mushroom', '5-7 days refrigerated', 'Paper bag in fridge'),
       ('shiitake', cat_mushroom, 'Asian mushroom', '1 week refrigerated', 'Store in paper bag'),
       ('portobello', cat_mushroom, 'Large brown mushroom', '5-7 days refrigerated',
        'Store in paper bag') on CONFLICT (name) DO NOTHING;

-- ========== FRUITS ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('lemon', cat_fruit, 'Sour citrus fruit', '2-3 weeks refrigerated', 'Store in crisper'),
       ('lime', cat_fruit, 'Tart green citrus', '2 weeks refrigerated', 'Store in crisper'),
       ('orange', cat_fruit, 'Sweet citrus fruit', '1-2 weeks', 'Room temperature or refrigerated'),
       ('apple', cat_fruit, 'Crisp sweet fruit', '1-2 months refrigerated', 'Store in crisper'),
       ('banana', cat_fruit, 'Yellow tropical fruit', '3-5 days', 'Room temperature'),
       ('tomato', cat_fruit, 'Red fruit (culinary vegetable)', '1 week', 'Store at room temperature'),
       ('avocado', cat_fruit, 'Creamy green fruit', '3-5 days', 'Ripen at room temp, then refrigerate'),
       ('mango', cat_fruit, 'Sweet tropical fruit', '5 days', 'Ripen at room temp'),
       ('pineapple', cat_fruit, 'Tropical spiky fruit', '3-5 days', 'Room temperature until ripe'),
       ('strawberry', cat_fruit, 'Sweet red berry', '3-7 days refrigerated', 'Don''t wash until ready to use'),
       ('blueberry', cat_fruit, 'Small blue berry', '1-2 weeks refrigerated', 'Store unwashed'),
       ('raspberry', cat_fruit, 'Delicate red berry', '2-3 days refrigerated', 'Very perishable, use quickly'),
       ('grape', cat_fruit, 'Small round fruit', '1 week refrigerated', 'Store unwashed in bag'),
       ('watermelon', cat_fruit, 'Large sweet melon', '1 week refrigerated', 'Refrigerate after cutting'),
       ('peach', cat_fruit, 'Fuzzy stone fruit', '3-5 days', 'Ripen at room temp'),
       ('pear', cat_fruit, 'Sweet tree fruit', '5-7 days', 'Ripen at room temp'),
       ('coconut', cat_fruit, 'Tropical nut fruit', '2-3 months whole',
        'Store whole at room temp') on CONFLICT (name) DO NOTHING;

-- ========== GRAINS, PASTA & BREAD ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Rice
    ('rice', cat_rice, 'Staple grain', '1-2 years', 'Store in airtight container'),
    ('white_rice', cat_rice, 'Polished rice', '1-2 years', 'Airtight container in cool place'),
    ('brown_rice', cat_rice, 'Whole grain rice', '6 months', 'Airtight container, consider refrigerating'),
    ('basmati_rice', cat_rice, 'Aromatic long-grain rice', '1-2 years', 'Airtight container'),
    ('jasmine_rice', cat_rice, 'Fragrant Thai rice', '1-2 years', 'Airtight container'),

    -- Grains
    ('oat', cat_grain, 'Whole grain cereal', '1-2 years', 'Airtight container'),
    ('quinoa', cat_grain, 'Protein-rich seed grain', '2-3 years', 'Airtight container'),
    ('barley', cat_grain, 'Chewy grain', '1 year', 'Airtight container'),
    ('bulgur', cat_grain, 'Cracked wheat', '1 year', 'Airtight container'),
    ('couscous', cat_grain, 'Tiny pasta pellets', '1 year', 'Airtight container'),

    -- Flour
    ('flour', cat_flour, 'Ground grain', '6-8 months', 'Airtight container in cool place'),
    ('all_purpose_flour', cat_flour, 'Versatile wheat flour', '6-8 months', 'Airtight container'),
    ('bread_flour', cat_flour, 'High-protein flour', '6-8 months', 'Airtight container'),
    ('whole_wheat_flour', cat_flour, 'Whole grain flour', '3-6 months', 'Refrigerate for longer storage'),

    -- Pasta
    ('pasta', cat_pasta, 'Italian noodle', '1-2 years', 'Store in package in dry place'),
    ('spaghetti', cat_pasta, 'Long thin pasta', '1-2 years', 'Store in dry place'),
    ('penne', cat_pasta, 'Tube-shaped pasta', '1-2 years', 'Store in dry place'),
    ('fettuccine', cat_pasta, 'Flat ribbon pasta', '1-2 years', 'Store in dry place'),

    -- Noodles
    ('rice_noodle', cat_noodle, 'Asian rice pasta', '1 year', 'Store in package'),
    ('ramen_noodle', cat_noodle, 'Japanese wheat noodle', '1 year', 'Store in dry place'),
    ('udon_noodle', cat_noodle, 'Thick Japanese noodle', '1 year', 'Store in package'),
    ('soba_noodle', cat_noodle, 'Buckwheat noodle', '1 year', 'Store in dry place'),

    -- Bread
    ('bread', cat_bread, 'Baked flour product', '3-5 days', 'Store at room temp or freeze'),
    ('baguette', cat_bread, 'French bread', '1-2 days', 'Best eaten fresh'),
    ('pita', cat_bread, 'Flatbread with pocket', '5-7 days', 'Store in bag'),
    ('tortilla', cat_bread, 'Thin flatbread', '1 week', 'Store in bag at room temp') on CONFLICT (name) DO NOTHING;

-- ========== LEGUMES, NUTS & SEEDS ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Legumes
    ('black_bean', cat_legume, 'Black turtle bean', '2-3 years dried', 'Airtight container in dry place'),
    ('kidney_bean', cat_legume, 'Red bean', '2-3 years dried', 'Airtight container'),
    ('chickpea', cat_legume, 'Garbanzo bean', '2-3 years dried', 'Airtight container'),
    ('lentil', cat_legume, 'Small lens-shaped legume', '2-3 years dried', 'Airtight container'),
    ('pinto_bean', cat_legume, 'Speckled bean', '2-3 years dried', 'Airtight container'),
    ('white_bean', cat_legume, 'Cannellini bean', '2-3 years dried', 'Airtight container'),

    -- Nuts
    ('almond', cat_nut, 'Mild tree nut', '1 year sealed', 'Airtight container, refrigerate'),
    ('walnut', cat_nut, 'Rich tree nut', '6 months', 'Refrigerate or freeze'),
    ('cashew', cat_nut, 'Creamy nut', '6-9 months', 'Airtight container'),
    ('peanut', cat_nut, 'Legume nut', '1-2 months shelled', 'Refrigerate for longer storage'),
    ('pecan', cat_nut, 'Sweet tree nut', '6 months', 'Refrigerate or freeze'),
    ('pine_nut', cat_nut, 'Small delicate nut', '1-2 months', 'Refrigerate or freeze'),

    -- Seeds
    ('sesame_seed', cat_seed, 'Tiny oil-rich seed', '6 months', 'Airtight container'),
    ('sunflower_seed', cat_seed, 'Mild nutty seed', '3 months', 'Airtight container, refrigerate'),
    ('pumpkin_seed', cat_seed, 'Green pepita seed', '3-4 months', 'Airtight container'),
    ('chia_seed', cat_seed, 'Tiny superfood seed', '2 years', 'Airtight container'),
    ('flaxseed', cat_seed, 'Omega-3 rich seed', '1 year', 'Refrigerate ground seeds') on CONFLICT (name) DO NOTHING;

-- ========== HERBS & SPICES ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Fresh Herbs
    ('basil', cat_herb, 'Sweet Italian herb', '1 week', 'Store like flowers in water'),
    ('parsley', cat_herb, 'Fresh green herb', '1 week refrigerated', 'Wrap in damp towel'),
    ('cilantro', cat_herb, 'Pungent herb (coriander leaves)', '1 week refrigerated', 'Store in water or damp towel'),
    ('oregano', cat_herb, 'Mediterranean herb', '1 week fresh, 1-3 years dried', 'Wrap fresh in damp towel'),
    ('thyme', cat_herb, 'Earthy herb', '1 week fresh, 1-3 years dried', 'Wrap in damp towel'),
    ('rosemary', cat_herb, 'Pine-scented herb', '2 weeks refrigerated', 'Store in bag in crisper'),
    ('mint', cat_herb, 'Cool refreshing herb', '1 week', 'Store in water like flowers'),
    ('dill', cat_herb, 'Delicate feathery herb', '1 week refrigerated', 'Wrap in damp towel'),
    ('sage', cat_herb, 'Earthy pungent herb', '1 week fresh', 'Wrap in damp towel'),
    ('chive', cat_herb, 'Mild onion-flavored herb', '1 week refrigerated', 'Store in bag'),
    ('bay_leaf', cat_herb, 'Aromatic leaf for cooking', '2-3 years dried', 'Store dried in airtight container'),

    -- Spices
    ('cumin', cat_spice, 'Warm earthy spice', '3-4 years whole, 2-3 years ground', 'Airtight container in dark place'),
    ('coriander', cat_spice, 'Citrusy spice (cilantro seed)', '3-4 years whole, 2-3 years ground',
     'Airtight container'),
    ('paprika', cat_spice, 'Sweet red pepper powder', '2-3 years', 'Airtight container, cool and dark'),
    ('turmeric', cat_spice, 'Yellow anti-inflammatory spice', '3-4 years', 'Airtight container'),
    ('cinnamon', cat_spice, 'Sweet warm spice', '3-4 years', 'Airtight container'),
    ('nutmeg', cat_spice, 'Sweet warm spice', '4 years whole, 2-3 ground', 'Store whole, grate fresh'),
    ('clove', cat_spice, 'Intense aromatic spice', '4 years', 'Airtight container'),
    ('cardamom', cat_spice, 'Aromatic sweet spice', '3-4 years', 'Store whole pods'),
    ('cayenne_pepper', cat_spice, 'Hot red pepper powder', '2-3 years', 'Airtight container'),
    ('chili_powder', cat_spice, 'Spice blend with chili', '2-3 years', 'Airtight container'),
    ('garam_masala', cat_spice, 'Indian spice blend', '1-2 years', 'Airtight container'),
    ('curry_powder', cat_spice, 'Spice blend', '2-3 years', 'Airtight container'),

    -- Seasonings
    ('salt', cat_seasoning, 'Sodium chloride', 'Indefinite', 'Keep dry'),
    ('sea_salt', cat_seasoning, 'Salt from evaporated seawater', 'Indefinite', 'Keep dry'),
    ('black_pepper', cat_seasoning, 'Common peppercorn', '3-4 years whole, 2-3 ground', 'Store whole, grind fresh'),
    ('white_pepper', cat_seasoning, 'Mild pepper', '3-4 years whole', 'Airtight container'),
    ('red_pepper_flake', cat_seasoning, 'Crushed dried chili', '2-3 years', 'Airtight container'),
    ('garlic_powder', cat_seasoning, 'Dried ground garlic', '2-3 years', 'Airtight container'),
    ('onion_powder', cat_seasoning, 'Dried ground onion', '2-3 years',
     'Airtight container') on CONFLICT (name) DO NOTHING;

-- ========== OILS, FATS & CONDIMENTS ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Oils
    ('olive_oil', cat_oil, 'Mediterranean oil', '1-2 years', 'Store in cool dark place'),
    ('extra_virgin_olive_oil', cat_oil, 'Premium olive oil', '1-2 years', 'Dark bottle in cool place'),
    ('vegetable_oil', cat_oil, 'Neutral cooking oil', '1-2 years', 'Store in cool place'),
    ('canola_oil', cat_oil, 'Light neutral oil', '1-2 years', 'Store in cool place'),
    ('sesame_oil', cat_oil, 'Aromatic Asian oil', '1 year', 'Refrigerate after opening'),
    ('coconut_oil', cat_oil, 'Tropical oil', '2 years', 'Room temperature, solid when cool'),
    ('peanut_oil', cat_oil, 'High-heat cooking oil', '1-2 years', 'Store in cool place'),

    -- Condiments
    ('soy_sauce', cat_condiment, 'Fermented soy liquid', '2-3 years', 'Refrigerate after opening'),
    ('fish_sauce', cat_condiment, 'Fermented fish liquid', '3-4 years', 'Store at room temperature'),
    ('worcestershire_sauce', cat_condiment, 'Savory fermented sauce', '3 years', 'Store in pantry'),
    ('hot_sauce', cat_condiment, 'Spicy chili sauce', '3 years', 'Refrigerate after opening'),
    ('ketchup', cat_condiment, 'Tomato condiment', '1 year', 'Refrigerate after opening'),
    ('mustard', cat_condiment, 'Tangy seed condiment', '1-2 years', 'Refrigerate after opening'),
    ('mayonnaise', cat_condiment, 'Egg-oil emulsion', '2-3 months opened', 'Refrigerate'),
    ('sriracha', cat_condiment, 'Thai hot chili sauce', '2 years', 'Refrigerate after opening'),

    -- Sauces & Pastes
    ('tomato_paste', cat_sauce, 'Concentrated tomato', '18 months unopened', 'Refrigerate after opening'),
    ('tomato_sauce', cat_sauce, 'Cooked tomato sauce', '18 months unopened', 'Refrigerate after opening'),
    ('pesto', cat_sauce, 'Basil-based sauce', '1 week refrigerated', 'Cover with oil, refrigerate'),
    ('tahini', cat_sauce, 'Sesame seed paste', '6 months', 'Refrigerate after opening'),
    ('miso_paste', cat_sauce, 'Fermented soy paste', '1 year refrigerated', 'Keep refrigerated'),
    ('curry_paste', cat_sauce, 'Spiced Thai paste', '1 year refrigerated', 'Refrigerate after opening'),

    -- Stock
    ('chicken_stock', cat_stock, 'Chicken bone broth', '3-4 days refrigerated, 4-6 months frozen',
     'Refrigerate or freeze'),
    ('vegetable_stock', cat_stock, 'Vegetable broth', '3-4 days refrigerated', 'Refrigerate or freeze'),
    ('beef_stock', cat_stock, 'Beef bone broth', '3-4 days refrigerated', 'Refrigerate or freeze'),

    -- Vinegar
    ('vinegar', cat_vinegar, 'Acetic acid liquid', 'Indefinite', 'Store in pantry'),
    ('white_vinegar', cat_vinegar, 'Distilled vinegar', 'Indefinite', 'Store in pantry'),
    ('apple_cider_vinegar', cat_vinegar, 'Fermented apple vinegar', 'Indefinite', 'Store in pantry'),
    ('balsamic_vinegar', cat_vinegar, 'Sweet Italian vinegar', 'Indefinite', 'Store in cool place'),
    ('rice_vinegar', cat_vinegar, 'Mild Asian vinegar', 'Indefinite', 'Store in pantry'),
    ('red_wine_vinegar', cat_vinegar, 'Wine-based vinegar', 'Indefinite',
     'Store in pantry') on CONFLICT (name) DO NOTHING;

-- ========== SWEETENERS & BAKING ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Sweeteners
    ('sugar', cat_sweetener, 'White granulated sugar', 'Indefinite', 'Keep dry in airtight container'),
    ('brown_sugar', cat_sweetener, 'Molasses sugar', '2 years', 'Keep airtight to prevent hardening'),
    ('powdered_sugar', cat_sweetener, 'Confectioners sugar', 'Indefinite', 'Keep dry'),
    ('honey', cat_sweetener, 'Bee-produced sweetener', 'Indefinite', 'Store at room temperature'),
    ('maple_syrup', cat_sweetener, 'Tree sap syrup', '1 year unopened', 'Refrigerate after opening'),
    ('agave_nectar', cat_sweetener, 'Agave plant sweetener', '2 years', 'Store in pantry'),

    -- Baking
    ('baking_powder', cat_baking, 'Leavening agent', '6 months-1 year', 'Keep dry in container'),
    ('baking_soda', cat_baking, 'Sodium bicarbonate', '2 years', 'Keep dry'),
    ('yeast', cat_baking, 'Active dry yeast', '2 years unopened', 'Refrigerate after opening'),
    ('vanilla_extract', cat_baking, 'Vanilla flavoring', '2-4 years', 'Store in cool dark place'),

    -- Chocolate
    ('cocoa_powder', cat_baking, 'Unsweetened chocolate powder', '2-3 years',
     'Airtight container') on CONFLICT (name) DO NOTHING;

-- ========== ASIAN INGREDIENTS ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Soy Products
    ('tofu', cat_dairy, 'Soybean curd', '3-5 days refrigerated', 'Keep in water, change daily'),
    ('firm_tofu', cat_dairy, 'Dense pressed tofu', '3-5 days refrigerated', 'Keep in water in fridge'),
    ('silken_tofu', cat_dairy, 'Soft unpressed tofu', '3-5 days refrigerated', 'Keep refrigerated'),
    ('tempeh', cat_legume, 'Fermented soybean cake', '1 week refrigerated', 'Keep refrigerated'),
    ('edamame', cat_legume, 'Young soybeans', '3 days refrigerated', 'Store in pods in fridge'),

    -- Asian Sauces & Condiments
    ('hoisin_sauce', cat_sauce, 'Sweet Chinese sauce', '1 year', 'Refrigerate after opening'),
    ('oyster_sauce', cat_sauce, 'Savory shellfish sauce', '1 year', 'Refrigerate after opening'),
    ('mirin', cat_alcohol, 'Sweet Japanese rice wine', '3 months opened', 'Refrigerate after opening'),
    ('rice_wine', cat_alcohol, 'Shaoxing cooking wine', '6 months opened', 'Store in cool place'),
    ('sambal_oelek', cat_condiment, 'Indonesian chili paste', '6 months', 'Refrigerate after opening'),
    ('gochujang', cat_sauce, 'Korean fermented chili paste', '1 year refrigerated', 'Keep refrigerated'),
    ('kimchi', cat_vegetable, 'Fermented Korean vegetables', '3-6 months refrigerated', 'Keep refrigerated'),

    -- Asian Vegetables
    ('bok_choy', cat_vegetable, 'Chinese cabbage', '3-4 days refrigerated', 'Store in crisper'),
    ('napa_cabbage', cat_vegetable, 'Chinese cabbage', '1 week refrigerated', 'Store in crisper'),
    ('daikon', cat_vegetable, 'Japanese radish', '1-2 weeks refrigerated', 'Store in crisper'),
    ('water_chesnut', cat_vegetable, 'Crunchy aquatic vegetable', '2 weeks refrigerated', 'Store in water'),
    ('bamboo_shoot', cat_vegetable, 'Young bamboo sprout', '1 week refrigerated', 'Store in water'),
    ('bean_sprout', cat_vegetable, 'Sprouted mung beans', '2-3 days refrigerated', 'Keep in sealed bag'),
    ('snow_pea', cat_vegetable, 'Flat edible pod pea', '3-5 days refrigerated', 'Store in crisper'),

    -- Asian Aromatics & Herbs
    ('lemongrass', cat_herb, 'Citrus-scented grass', '2 weeks refrigerated', 'Store in plastic bag'),
    ('galangal', cat_vegetable, 'Thai ginger relative', '2 weeks refrigerated', 'Wrap and refrigerate'),
    ('kaffir_lime_leaf', cat_herb, 'Aromatic Thai leaf', '1 week fresh, 1 year frozen', 'Freeze for long storage'),
    ('shiso', cat_herb, 'Japanese perilla leaf', '1 week refrigerated', 'Wrap in damp towel'),
    ('thai_basil', cat_herb, 'Anise-scented basil', '1 week', 'Store in water'),

    -- Seaweed & Sea Vegetables
    ('nori', cat_vegetable, 'Dried seaweed sheets', '1 year', 'Keep in airtight container'),
    ('wakame', cat_vegetable, 'Japanese seaweed', '1 year dried', 'Store in airtight container'),
    ('kombu', cat_vegetable, 'Kelp for dashi', '1 year', 'Store in cool dry place'),

    -- Asian Specialty Items
    ('tamarind', cat_fruit, 'Sour tropical fruit paste', '1 year', 'Store in cool place'),
    ('star_anise', cat_spice, 'Star-shaped licorice spice', '3-4 years', 'Airtight container'),
    ('sichuan_peppercorn', cat_spice, 'Numbing Chinese spice', '2-3 years', 'Airtight container'),
    ('five_spice_powder', cat_spice, 'Chinese spice blend', '2-3 years',
     'Airtight container') on CONFLICT (name) DO NOTHING;

-- ========== MIDDLE EASTERN & MEDITERRANEAN ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Proteins & Dairy
    ('paneer', cat_cheese, 'Indian fresh cheese', '1 week refrigerated', 'Keep refrigerated in water'),
    ('halloumi', cat_cheese, 'Grilling cheese', '1 week refrigerated', 'Store in brine'),
    ('ghee', cat_fat, 'Clarified butter', '3 months room temp, 1 year refrigerated', 'Store in airtight jar'),
    ('labneh', cat_dairy, 'Strained yogurt cheese', '1-2 weeks refrigerated', 'Keep refrigerated'),

    -- Spices & Seasonings
    ('sumac', cat_spice, 'Tangy red berry spice', '2-3 years', 'Airtight container'),
    ('zaatar', cat_spice, 'Middle Eastern herb blend', '6 months', 'Airtight container'),
    ('harissa', cat_sauce, 'North African chili paste', '6 months refrigerated', 'Refrigerate after opening'),
    ('ras_el_hanout', cat_spice, 'Moroccan spice blend', '1-2 years', 'Airtight container'),
    ('fenugreek', cat_spice, 'Bitter aromatic seed', '3-4 years', 'Airtight container'),
    ('nigella_seed', cat_seed, 'Black cumin seed', '2-3 years', 'Airtight container'),
    ('saffron', cat_spice, 'Expensive red spice threads', '2-3 years', 'Airtight container in dark place'),

    -- Condiments & Preserves
    ('pomegranate_molasses', cat_condiment, 'Concentrated pomegranate syrup', '1 year', 'Store in pantry'),
    ('preserved_lemon', cat_condiment, 'Salt-cured lemon', '1 year refrigerated', 'Keep in brine'),
    ('olive', cat_fruit, 'Brined Mediterranean fruit', '1 year unopened', 'Keep in brine after opening'),
    ('kalamata_olive', cat_fruit, 'Greek black olive', '1 year', 'Keep in brine'),
    ('caper', cat_condiment, 'Pickled flower bud', '1 year', 'Keep in brine'),
    ('anchovy', cat_seafood, 'Small preserved fish', '1 year unopened', 'Refrigerate after opening'),
    ('sun_dried_tomato', cat_vegetable, 'Dried concentrated tomato', '6 months in oil', 'Store in oil or dry'),

    -- Grains & Legumes
    ('farro', cat_grain, 'Ancient wheat grain', '1 year', 'Airtight container'),
    ('freekeh', cat_grain, 'Roasted green wheat', '1 year', 'Airtight container'),
    ('red_lentil', cat_legume, 'Quick-cooking lentil', '2-3 years', 'Airtight container'),
    ('green_lentil', cat_legume, 'Firm cooking lentil', '2-3 years', 'Airtight container'),
    ('fava_bean', cat_legume, 'Broad bean', '2-3 years dried', 'Airtight container'),
    ('split_pea', cat_legume, 'Dried split peas', '2-3 years', 'Airtight container') on CONFLICT (name) DO NOTHING;

-- ========== LATIN AMERICAN & MEXICAN ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values
    -- Chilies & Peppers
    ('poblano', cat_vegetable, 'Mild Mexican pepper', '1 week refrigerated', 'Store in crisper'),
    ('serrano', cat_vegetable, 'Hot green chili', '1 week refrigerated', 'Store in crisper'),
    ('habanero', cat_vegetable, 'Very hot orange pepper', '1 week refrigerated', 'Store in crisper'),
    ('chipotle', cat_spice, 'Smoked dried jalapeño', '1 year', 'Airtight container'),
    ('ancho_chili', cat_spice, 'Dried poblano pepper', '1 year', 'Airtight container'),

    -- Vegetables & Fruits
    ('tomatillo', cat_vegetable, 'Green husk tomato', '1 week refrigerated', 'Store in paper bag'),
    ('plantain', cat_fruit, 'Starchy banana relative', '1 week', 'Ripen at room temperature'),
    ('jicama', cat_vegetable, 'Crunchy root vegetable', '2-3 weeks refrigerated', 'Store in crisper'),
    ('nopal', cat_vegetable, 'Cactus paddle', '1 week refrigerated', 'Store in plastic bag'),
    ('yucca', cat_vegetable, 'Starchy root vegetable', '1 week', 'Store in cool place'),

    -- Grains & Legumes
    ('masa_harina', cat_flour, 'Corn flour for tortillas', '1 year', 'Airtight container'),
    ('hominy', cat_grain, 'Treated corn kernels', '1 year dried', 'Airtight container'),
    ('black_bean', cat_legume, 'Latin American bean', '2-3 years dried', 'Airtight container'),

    -- Sauces & Seasonings
    ('adobo_sauce', cat_sauce, 'Mexican chili sauce', '6 months refrigerated', 'Refrigerate after opening'),
    ('salsa_verde', cat_sauce, 'Green tomatillo sauce', '1 week refrigerated', 'Keep refrigerated'),
    ('mexican_oregano', cat_herb, 'Citrusy oregano variety', '1-3 years dried', 'Airtight container'),
    ('epazote', cat_herb, 'Pungent Mexican herb', '1 week fresh', 'Store in plastic bag'),
    ('annatto', cat_spice, 'Red coloring spice', '2-3 years', 'Airtight container') on CONFLICT (name) DO NOTHING;

-- ========== MORE SEAFOOD ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('halibut', cat_seafood, 'Firm white fish', '1-2 days refrigerated', 'Store on ice'),
       ('sea_bass', cat_seafood, 'Delicate white fish', '1-2 days refrigerated', 'Store on ice'),
       ('mahi_mahi', cat_seafood, 'Firm tropical fish', '1-2 days refrigerated', 'Store on ice'),
       ('swordfish', cat_seafood, 'Meaty steak fish', '1-2 days refrigerated', 'Store on ice'),
       ('clam', cat_seafood, 'Bivalve mollusk', '1-2 days refrigerated', 'Keep cold and moist'),
       ('mussel', cat_seafood, 'Small black shellfish', '1-2 days refrigerated', 'Store in bowl with damp towel'),
       ('oyster', cat_seafood, 'Briny mollusk', '1-2 days refrigerated', 'Keep very cold'),
       ('squid', cat_seafood, 'Cephalopod mollusk', '1-2 days refrigerated', 'Store on ice'),
       ('octopus', cat_seafood, 'Eight-armed cephalopod', '1-2 days refrigerated', 'Store on ice'),
       ('sardine', cat_seafood, 'Small oily fish', '1-2 days fresh',
        'Use quickly or buy canned') on CONFLICT (name) DO NOTHING;

-- ========== MORE MEATS & CHARCUTERIE ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('prosciutto', cat_meat, 'Italian cured ham', '2-3 weeks refrigerated', 'Wrap tightly'),
       ('salami', cat_meat, 'Italian cured sausage', '3-4 weeks refrigerated', 'Keep wrapped'),
       ('chorizo', cat_meat, 'Spanish/Mexican sausage', '1 week fresh, 4 weeks cured', 'Refrigerate'),
       ('pancetta', cat_meat, 'Italian cured pork belly', '3 weeks refrigerated', 'Wrap tightly'),
       ('italian_sausage', cat_meat, 'Seasoned pork sausage', '1-2 days refrigerated', 'Use quickly or freeze'),
       ('bratwurst', cat_meat, 'German sausage', '1-2 days refrigerated', 'Use quickly or freeze'),
       ('andouille', cat_meat, 'Cajun smoked sausage', '1 week refrigerated',
        'Keep refrigerated') on CONFLICT (name) DO NOTHING;

-- ========== MORE VEGETABLES & SPECIALTY ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('artichoke', cat_vegetable, 'Thistle flower bud', '1 week refrigerated', 'Store in plastic bag'),
       ('okra', cat_vegetable, 'Green pod vegetable', '3-4 days refrigerated', 'Store in paper bag'),
       ('rhubarb', cat_vegetable, 'Tart pink stalk', '1 week refrigerated', 'Store in plastic bag'),
       ('kohlrabi', cat_vegetable, 'German turnip', '2 weeks refrigerated', 'Store in crisper'),
       ('rutabaga', cat_vegetable, 'Yellow root vegetable', '2-3 weeks refrigerated', 'Store in crisper'),
       ('parsnip', cat_vegetable, 'White root vegetable', '2-3 weeks refrigerated', 'Store in crisper'),
       ('celery_root', cat_vegetable, 'Celeriac root', '1-2 weeks refrigerated', 'Store in crisper'),
       ('radicchio', cat_vegetable, 'Bitter red lettuce', '1 week refrigerated', 'Store in crisper'),
       ('endive', cat_vegetable, 'Bitter leafy vegetable', '1 week refrigerated', 'Store in crisper'),
       ('swiss_chard', cat_vegetable, 'Colorful leafy green', '3-5 days refrigerated', 'Store in crisper'),
       ('collard_green', cat_vegetable, 'Hearty Southern green', '1 week refrigerated', 'Store in crisper'),
       ('mustard_green', cat_vegetable, 'Peppery leafy green', '3-5 days refrigerated',
        'Store in crisper') on CONFLICT (name) DO NOTHING;

-- ========== MORE CHEESE ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('brie', cat_cheese, 'Soft French cheese', '1 week refrigerated', 'Wrap in wax paper'),
       ('camembert', cat_cheese, 'Creamy French cheese', '1 week refrigerated', 'Wrap in wax paper'),
       ('gorgonzola', cat_cheese, 'Italian blue cheese', '3-4 weeks refrigerated', 'Wrap tightly'),
       ('gruyere', cat_cheese, 'Swiss Alpine cheese', '3-4 weeks refrigerated', 'Wrap tightly'),
       ('manchego', cat_cheese, 'Spanish sheep cheese', '3-4 weeks refrigerated', 'Wrap tightly'),
       ('pecorino', cat_cheese, 'Italian sheep cheese', '6 months refrigerated', 'Wrap tightly'),
       ('ricotta', cat_cheese, 'Fresh Italian whey cheese', '1 week refrigerated', 'Keep refrigerated'),
       ('mascarpone', cat_cheese, 'Italian cream cheese', '1 week refrigerated', 'Keep refrigerated'),
       ('blue_cheese', cat_cheese, 'Veined aged cheese', '3-4 weeks refrigerated',
        'Wrap tightly') on CONFLICT (name) DO NOTHING;

-- ========== MORE NUTS & DRIED FRUIT ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('hazelnut', cat_nut, 'Sweet tree nut', '6 months', 'Refrigerate or freeze'),
       ('pistachio', cat_nut, 'Green nut', '3 months', 'Airtight container'),
       ('macadamia', cat_nut, 'Buttery tropical nut', '6 months', 'Refrigerate'),
       ('brazil_nut', cat_nut, 'Large South American nut', '6 months', 'Refrigerate'),
       ('raisin', cat_fruit, 'Dried grape', '6 months', 'Airtight container'),
       ('date', cat_fruit, 'Sweet dried fruit', '6 months', 'Airtight container'),
       ('fig', cat_fruit, 'Sweet fruit', '1 week fresh, 6 months dried', 'Refrigerate fresh'),
       ('apricot', cat_fruit, 'Stone fruit', '1 week fresh, 6 months dried', 'Room temp until ripe'),
       ('prune', cat_fruit, 'Dried plum', '6 months', 'Airtight container'),
       ('cranberry', cat_fruit, 'Tart red berry', '1 month fresh, 1 year frozen',
        'Refrigerate or freeze') on CONFLICT (name) DO NOTHING;

-- ========== MORE SPECIALTY INGREDIENTS ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('nutritional_yeast', cat_seasoning, 'Cheesy vegan seasoning', '2 years', 'Airtight container'),
       ('cornstarch', cat_flour, 'Corn-based thickener', 'Indefinite', 'Keep dry'),
       ('arrowroot', cat_flour, 'Starchy thickening powder', '2-3 years', 'Airtight container'),
       ('potato_starch', cat_flour, 'Potato-based thickener', '2 years', 'Keep dry'),
       ('gelatin', cat_baking, 'Setting agent', '3-4 years', 'Keep dry'),
       ('agar_agar', cat_baking, 'Vegan gelatin alternative', '2-3 years', 'Keep dry'),
       ('cream_of_tartar', cat_baking, 'Acidic powder', '2-3 years', 'Keep dry'),
       ('peanut_butter', cat_nut, 'Ground peanut spread', '3-4 months opened', 'Refrigerate natural kinds'),
       ('almond_butter', cat_nut, 'Ground almond spread', '3-4 months opened', 'Refrigerate after opening'),
       ('jam', cat_fruit, 'Fruit preserve', '1 year unopened', 'Refrigerate after opening'),
       ('marmalade', cat_fruit, 'Citrus preserve', '1 year unopened',
        'Refrigerate after opening') on CONFLICT (name) DO NOTHING;

-- ========== ALCOHOL & BEVERAGES ==========

insert into ingredients (name, category_id, description, shelf_life, storage_tips)
values ('white_wine', cat_alcohol, 'Light wine for cooking', '3-5 days opened', 'Refrigerate after opening'),
       ('red_wine', cat_alcohol, 'Full-bodied wine', '3-5 days opened', 'Cork and store in cool place'),
       ('sake', cat_alcohol, 'Japanese rice wine', '1 week opened', 'Refrigerate after opening'),
       ('beer', cat_alcohol, 'Brewed grain beverage', '3 months unopened', 'Keep cool'),
       ('brandy', cat_alcohol, 'Distilled wine spirit', 'Indefinite', 'Store at room temp'),
       ('rum', cat_alcohol, 'Sugarcane spirit', 'Indefinite', 'Store at room temp'),
       ('vodka', cat_alcohol, 'Neutral grain spirit', 'Indefinite', 'Store at room temp'),
       ('sherry', cat_alcohol, 'Fortified wine', '1-2 weeks opened', 'Refrigerate after opening'),
       ('vermouth', cat_alcohol, 'Aromatized wine', '1 month opened', 'Refrigerate after opening'),
       ('coffee', cat_beverage, 'Brewed coffee beverage', '2 weeks ground beans', 'Airtight container in cool place'),
       ('tea', cat_beverage, 'Steeped tea leaves', '6 months-2 years', 'Airtight container'),
       ('coconut_milk', cat_dairy, 'Creamy coconut liquid', '4-6 days opened', 'Refrigerate after opening'),
       ('almond_milk', cat_beverage, 'Nut-based milk', '7-10 days opened',
        'Refrigerate after opening') on CONFLICT (name) DO NOTHING;

end $$;

-- Create some common ingredient relationships (parent_id)
update ingredients
set parent_id = ( select id from ingredients where name = 'beef' )
where name in ('ground_beef', 'beef_chuck', 'beef_sirloin');

update ingredients
set parent_id = ( select id from ingredients where name = 'pork' )
where name in ('pork_chop', 'ground_pork', 'bacon');

update ingredients
set parent_id = ( select id from ingredients where name = 'lamb' )
where name = 'leg_of_lamb';

update ingredients
set parent_id = ( select id from ingredients where name = 'chicken' )
where name in ('chicken_breast', 'chicken_thigh', 'whole_chicken', 'ground_chicken');

update ingredients
set parent_id = ( select id from ingredients where name = 'turkey' )
where name = 'turkey_breast';

update ingredients
set parent_id = ( select id from ingredients where name = 'bell_pepper' )
where name = 'red_bell_pepper';

update ingredients
set parent_id = ( select id from ingredients where name = 'tomato' )
where name = 'cherry_tomato';

update ingredients
set parent_id = ( select id from ingredients where name = 'rice' )
where name in ('white_rice', 'brown_rice', 'basmati_rice', 'jasmine_rice');

update ingredients
set parent_id = ( select id from ingredients where name = 'flour' )
where name in ('all_purpose_flour', 'bread_flour', 'whole_wheat_flour');

update ingredients
set parent_id = ( select id from ingredients where name = 'pasta' )
where name in ('spaghetti', 'penne', 'fettuccine');

update ingredients
set parent_id = ( select id from ingredients where name = 'mushroom' )
where name in ('button_mushroom', 'shiitake', 'portobello');

update ingredients
set parent_id = ( select id from ingredients where name = 'olive_oil' )
where name = 'extra_virgin_olive_oil';

update ingredients
set parent_id = ( select id from ingredients where name = 'vinegar' )
where name in ('white_vinegar', 'apple_cider_vinegar', 'balsamic_vinegar', 'rice_vinegar', 'red_wine_vinegar');

update ingredients
set parent_id = ( select id from ingredients where name = 'sugar' )
where name in ('brown_sugar', 'powdered_sugar');

update ingredients
set parent_id = ( select id from ingredients where name = 'bread' )
where name in ('baguette', 'pita', 'tortilla');

update ingredients
set parent_id = ( select id from ingredients where name = 'tofu' )
where name in ('firm_tofu', 'silken_tofu');

update ingredients
set parent_id = ( select id from ingredients where name = 'onion' )
where name in ('red_onion', 'shallot');

update ingredients
set parent_id = ( select id from ingredients where name = 'lentil' )
where name in ('red_lentil', 'green_lentil');

update ingredients
set parent_id = ( select id from ingredients where name = 'olive' )
where name = 'kalamata_olive';

update ingredients
set parent_id = ( select id from ingredients where name = 'chili_pepper' )
where name in ('poblano', 'serrano', 'habanero', 'jalapeno');

update ingredients
set parent_id = ( select id from ingredients where name = 'basil' )
where name = 'thai_basil';

update ingredients
set parent_id = ( select id from ingredients where name = 'oregano' )
where name = 'mexican_oregano';
