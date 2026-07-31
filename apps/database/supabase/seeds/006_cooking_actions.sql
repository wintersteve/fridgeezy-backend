-- Seed data for cooking actions, categories, and aliases

-- Seed cooking action categories
insert into cooking_action_categories (name, description, sort_order)
values ('preparation', 'Preparing ingredients before cooking (chopping, peeling, measuring)', 10),
       ('mixing', 'Combining ingredients (mixing, whisking, folding)', 20),
       ('heat_cooking', 'Cooking methods using heat (baking, grilling, frying)', 30),
       ('liquid_cooking', 'Cooking with liquids (boiling, simmering, steaming)', 40),
       ('temperature_control', 'Managing cooking temperature (preheating, cooling, chilling)', 50),
       ('finishing', 'Final touches and plating (garnishing, drizzling, serving)', 60),
       ('storage', 'Storing and preserving (refrigerating, freezing, canning)', 70),
       ('seasoning', 'Adding flavors (seasoning, marinating, glazing)', 80),
       ('measurement', 'Measuring and portioning (weighing, dividing, portioning)', 90),
       ('other', 'Miscellaneous actions not fitting other categories', 100)
on conflict (name) do nothing;

-- Seed preparation actions
insert into cooking_actions (category_id, name, description, tips)
select id,
       'cut',
       'Generic cutting action',
       'Use a sharp knife and a stable cutting board for safety'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'chop', 'Cut into irregular pieces', 'Keep fingertips curled away from the blade'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'dice', 'Cut into uniform cubes', 'Common sizes: small (1/4"), medium (1/2"), large (3/4")'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'mince', 'Cut into very fine pieces', 'Rock the knife back and forth for efficiency'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'slice', 'Cut into thin, flat pieces', 'Use a slicing motion rather than pressing down'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'julienne', 'Cut into thin matchsticks', 'Typically 1/8" × 1/8" × 2-3" in size'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'cube', 'Cut into larger uniform cubes', 'Larger than dice, typically 1" or more'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'shred', 'Cut into thin strips', 'Can be done with a knife, grater, or food processor'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'grate', 'Reduce to small particles using grater', 'Use different grater sizes for different textures'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'zest', 'Remove outer peel of citrus', 'Avoid the white pith as it can be bitter'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'peel', 'Remove outer skin or layer', 'Use a vegetable peeler or paring knife'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'trim', 'Remove unwanted parts', 'Trim fat, stems, or damaged portions'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'carve', 'Cut cooked meat into slices', 'Let meat rest before carving for better juices retention'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'score', 'Make shallow cuts in surface', 'Helps with cooking penetration and presentation'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'debone', 'Remove bones from meat or fish', 'Use a sharp, flexible boning knife'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'fillet', 'Remove bones and cut fish into flat pieces', 'Follow the natural contours of the fish'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'butterfly', 'Cut meat almost in half and open flat', 'Useful for even cooking of thick cuts'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'segment', 'Separate citrus into individual sections', 'Remove membranes for clean segments'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'roll', 'Shape into cylindrical form', 'Apply even pressure when rolling'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'shape', 'Form into desired shape', 'Wet hands when shaping sticky ingredients'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'press', 'Apply pressure to shape or flatten', 'Use consistent, even pressure'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'flatten', 'Make flat', 'Use plastic wrap to prevent sticking'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'pound', 'Beat to tenderize or thin', 'Place between plastic wrap to avoid tearing'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'knead', 'Work dough with hands', 'Push, fold, and turn repeatedly to develop gluten'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'crimp', 'Seal edges with decorative pattern', 'Common for pie crusts and dumplings'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'wash', 'Clean with water', 'Wash produce just before using'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'rinse', 'Quick wash to remove residue', 'Rinse under cold running water'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'drain', 'Remove liquid', 'Use a colander or strainer'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'pat_dry', 'Remove moisture with towels', 'Essential for getting a good sear'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'soak', 'Submerge in liquid', 'Softens dried ingredients or removes impurities'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'brine', 'Soak in salt solution', 'Enhances moisture and flavor in meat'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'flour', 'Coat with flour', 'Shake off excess flour before cooking'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'bread', 'Coat with breadcrumbs', 'Standard breading: flour, egg, breadcrumbs'
from cooking_action_categories
where name = 'preparation'
union all
select id, 'dredge', 'Coat lightly with dry ingredient', 'Typically flour or cornstarch'
from cooking_action_categories
where name = 'preparation'
on conflict (name) do nothing;

-- Seed mixing actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'mix', 'Combine ingredients', 'Mix until ingredients are evenly distributed'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'stir', 'Move in circular motion', 'Stir gently to avoid breaking delicate ingredients'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'whisk', 'Beat rapidly with whisk', 'Use a balloon whisk for maximum air incorporation'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'beat', 'Mix vigorously', 'Beat until smooth and well combined'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'fold', 'Gently combine by lifting and turning', 'Use a rubber spatula and gentle motion to preserve air'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'combine', 'Bring ingredients together', 'Mix until no streaks remain'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'blend', 'Mix until smooth', 'Can be done by hand or with a blender'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'emulsify', 'Combine oil and water-based liquids', 'Add oil slowly while whisking constantly'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'cream', 'Beat fat and sugar until fluffy', 'Properly creamed mixture should be pale and doubled in volume'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'whip', 'Beat rapidly to incorporate air', 'Common for cream or egg whites'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'toss', 'Mix by lifting and dropping', 'Gentle method for salads or delicate items'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'incorporate', 'Add and mix in completely', 'Ensure even distribution throughout the mixture'
from cooking_action_categories
where name = 'mixing'
union all
select id, 'dissolve', 'Mix until solid becomes liquid', 'Stir until no crystals or particles remain'
from cooking_action_categories
where name = 'mixing'
on conflict (name) do nothing;

-- Seed heat cooking actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'bake', 'Cook in oven with dry heat', 'Preheat oven for consistent results'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'roast', 'Cook in oven at high heat', 'Typically for meats and vegetables at 400°F or higher'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'broil', 'Cook under direct high heat', 'Keep oven door slightly open and watch carefully'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'grill', 'Cook over direct heat', 'Oil grates to prevent sticking'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'toast', 'Brown surface with dry heat', 'Watch carefully to avoid burning'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'char', 'Blacken surface with high heat', 'Adds smoky flavor to peppers, onions, etc.'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'sear', 'Brown surface quickly at high heat', 'Pat food dry and use hot pan for best sear'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'caramelize', 'Heat sugars until brown', 'Low and slow heat develops the best flavor'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'brown', 'Cook until surface is brown', 'Creates flavor through Maillard reaction'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'crisp', 'Make crispy with heat', 'High heat or prolonged cooking removes moisture'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'griddle', 'Cook on flat heated surface', 'Use for pancakes, eggs, burgers'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'fry', 'Cook in hot oil', 'Maintain proper oil temperature for crispy results'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'deep_fry', 'Submerge in hot oil', 'Use a thermometer to maintain 350-375°F'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'pan_fry', 'Fry in shallow oil', 'Oil should come halfway up the food'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'sauté', 'Cook quickly in small amount of fat', 'Keep food moving for even cooking'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'stir_fry', 'Cook quickly while stirring in hot pan', 'Use high heat and constant motion'
from cooking_action_categories
where name = 'heat_cooking'
union all
select id, 'shallow_fry', 'Fry in moderate amount of oil', 'More oil than sautéing, less than deep frying'
from cooking_action_categories
where name = 'heat_cooking'
on conflict (name) do nothing;

-- Seed liquid cooking actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'boil', 'Heat liquid to bubbling point', 'Full rolling boil is 212°F at sea level'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'simmer', 'Cook in liquid just below boiling', 'Small bubbles should gently break the surface'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'poach', 'Cook gently in liquid', 'Water should be 160-180°F with no bubbles'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'blanch', 'Briefly boil then cool', 'Stops cooking process and sets color'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'parboil', 'Partially cook by boiling', 'Precooks food before finishing with another method'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'steam', 'Cook with steam', 'Food should not touch the water'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'braise', 'Cook slowly in liquid', 'Combination of searing and slow cooking in liquid'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'stew', 'Simmer in liquid for extended time', 'Low heat for several hours develops flavor'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'deglaze', 'Add liquid to dissolve browned bits', 'Use wine, stock, or water to capture fond'
from cooking_action_categories
where name = 'liquid_cooking'
union all
select id, 'reduce', 'Boil to decrease volume and concentrate', 'Creates more intense flavor and thicker consistency'
from cooking_action_categories
where name = 'liquid_cooking'
on conflict (name) do nothing;

-- Seed temperature control actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'preheat', 'Heat oven or pan before use', 'Allow 10-15 minutes for oven to reach temperature'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'heat', 'Apply heat', 'Start with medium heat unless specified otherwise'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'warm', 'Raise to warm temperature', 'Low heat to gently warm without cooking'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'cool', 'Lower temperature', 'Transfer to wire rack for air circulation'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'chill', 'Refrigerate to cold temperature', 'Refrigerate at 40°F or below'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'freeze', 'Lower to freezing temperature', 'Store at 0°F for best quality'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'thaw', 'Defrost frozen food', 'Thaw in refrigerator for food safety'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'temper', 'Gradually adjust temperature', 'Prevents cracking or curdling'
from cooking_action_categories
where name = 'temperature_control'
union all
select id, 'rest', 'Let sit at room temperature', 'Allows juices to redistribute in meat'
from cooking_action_categories
where name = 'temperature_control'
on conflict (name) do nothing;

-- Seed finishing actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'garnish', 'Add decorative or flavorful element', 'Should be edible and complement the dish'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'plate', 'Arrange food on plate', 'Consider color, height, and negative space'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'serve', 'Present food for eating', 'Serve at proper temperature'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'drizzle', 'Pour in thin stream', 'Use for sauces, oils, or glazes'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'sprinkle', 'Scatter in small amounts', 'Distribute evenly over the surface'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'dust', 'Lightly coat surface', 'Use a fine-mesh sieve for even dusting'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'glaze', 'Coat with shiny finish', 'Apply during or after cooking for shine'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'brush', 'Apply with brush', 'Use for egg wash, butter, or glazes'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'top', 'Place on top', 'Add final layer or finishing touch'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'arrange', 'Position attractively', 'Create visual appeal on the plate'
from cooking_action_categories
where name = 'finishing'
union all
select id, 'present', 'Display for serving', 'Make the dish look appetizing'
from cooking_action_categories
where name = 'finishing'
on conflict (name) do nothing;

-- Seed storage actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'store', 'Keep for later use', 'Use airtight containers for best results'
from cooking_action_categories
where name = 'storage'
union all
select id, 'refrigerate', 'Store in refrigerator', 'Keep at 40°F or below'
from cooking_action_categories
where name = 'storage'
union all
select id, 'can', 'Preserve in sealed containers', 'Follow proper canning procedures for safety'
from cooking_action_categories
where name = 'storage'
union all
select id, 'jar', 'Store in jars', 'Sterilize jars before use'
from cooking_action_categories
where name = 'storage'
union all
select id, 'preserve', 'Treat to prevent spoilage', 'Use salt, sugar, vinegar, or heat'
from cooking_action_categories
where name = 'storage'
union all
select id, 'cover', 'Protect with covering', 'Prevents drying out or contamination'
from cooking_action_categories
where name = 'storage'
union all
select id, 'wrap', 'Enclose in wrapping material', 'Use plastic wrap, foil, or parchment'
from cooking_action_categories
where name = 'storage'
union all
select id, 'seal', 'Close tightly', 'Prevents air and moisture from entering'
from cooking_action_categories
where name = 'storage'
on conflict (name) do nothing;

-- Seed seasoning actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'season', 'Add seasonings', 'Season throughout cooking, not just at the end'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'taste', 'Sample to check flavor', 'Taste before serving and adjust as needed'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'adjust', 'Modify seasoning levels', 'Balance salt, acid, sweet, and heat'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'salt', 'Add salt', 'Salt enhances other flavors'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'pepper', 'Add pepper', 'Use freshly ground for best flavor'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'spice', 'Add spices', 'Toast whole spices before grinding for more flavor'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'flavor', 'Add flavor', 'Layer flavors throughout the cooking process'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'infuse', 'Steep to impart flavor', 'Heat gently to extract flavors'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'cure', 'Preserve with salt or sugar', 'Draws out moisture and adds flavor'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'marinate', 'Soak in seasoned liquid', 'Marinate in refrigerator, not at room temperature'
from cooking_action_categories
where name = 'seasoning'
union all
select id, 'oil', 'Coat with oil', 'Prevents sticking and adds richness'
from cooking_action_categories
where name = 'seasoning'
on conflict (name) do nothing;

-- Seed measurement actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'measure', 'Determine quantity', 'Use proper measuring tools for accuracy'
from cooking_action_categories
where name = 'measurement'
union all
select id, 'weigh', 'Determine weight', 'Most accurate method for baking'
from cooking_action_categories
where name = 'measurement'
union all
select id, 'portion', 'Divide into servings', 'Use a scale or scoop for consistency'
from cooking_action_categories
where name = 'measurement'
union all
select id, 'divide', 'Separate into parts', 'Divide evenly for uniform cooking'
from cooking_action_categories
where name = 'measurement'
union all
select id, 'halve', 'Cut into two equal parts', 'Divide into two equal portions'
from cooking_action_categories
where name = 'measurement'
union all
select id, 'quarter', 'Cut into four equal parts', 'Divide into four equal portions'
from cooking_action_categories
where name = 'measurement'
on conflict (name) do nothing;

-- Seed other miscellaneous actions
insert into cooking_actions (category_id, name, description, tips)
select id, 'transfer', 'Move to different container', 'Use spatula or spoon to avoid spills'
from cooking_action_categories
where name = 'other'
union all
select id, 'add', 'Put in additional ingredient', 'Add ingredients in the order specified'
from cooking_action_categories
where name = 'other'
union all
select id, 'remove', 'Take out', 'Remove from heat or container'
from cooking_action_categories
where name = 'other'
union all
select id, 'discard', 'Throw away', 'Dispose of unwanted parts'
from cooking_action_categories
where name = 'other'
union all
select id, 'reserve', 'Set aside for later use', 'Keep warm or refrigerate as needed'
from cooking_action_categories
where name = 'other'
union all
select id, 'set_aside', 'Temporarily put aside', 'Keep within reach for later use'
from cooking_action_categories
where name = 'other'
union all
select id, 'strain', 'Separate solid from liquid', 'Use fine-mesh strainer for smooth results'
from cooking_action_categories
where name = 'other'
union all
select id, 'filter', 'Remove particles from liquid', 'Use cheesecloth or coffee filter'
from cooking_action_categories
where name = 'other'
union all
select id, 'squeeze', 'Extract liquid by pressure', 'Use for citrus juice or removing excess water'
from cooking_action_categories
where name = 'other'
union all
select id, 'mash', 'Crush into soft mass', 'Use fork, masher, or ricer'
from cooking_action_categories
where name = 'other'
union all
select id, 'puree', 'Blend until smooth', 'Use blender or food processor'
from cooking_action_categories
where name = 'other'
union all
select id, 'grind', 'Reduce to small particles or powder', 'Use mortar and pestle or grinder'
from cooking_action_categories
where name = 'other'
union all
select id, 'crush', 'Break into small pieces', 'Use flat side of knife or mallet'
from cooking_action_categories
where name = 'other'
union all
select id, 'crack', 'Break open', 'Common for eggs and nuts'
from cooking_action_categories
where name = 'other'
union all
select id, 'pit', 'Remove pit or stone from fruit', 'Use sharp knife or pitter tool'
from cooking_action_categories
where name = 'other'
union all
select id, 'core', 'Remove core from fruit', 'Use corer or paring knife'
from cooking_action_categories
where name = 'other'
union all
select id, 'seed', 'Remove seeds', 'Scrape out with spoon or knife'
from cooking_action_categories
where name = 'other'
union all
select id, 'stuff', 'Fill with filling', 'Don''t overfill to prevent bursting'
from cooking_action_categories
where name = 'other'
union all
select id, 'skewer', 'Thread onto skewers', 'Soak wooden skewers to prevent burning'
from cooking_action_categories
where name = 'other'
union all
select id, 'tie', 'Secure with string', 'Use kitchen twine for trussing'
from cooking_action_categories
where name = 'other'
union all
select id, 'layer', 'Arrange in layers', 'Create distinct layers for casseroles or cakes'
from cooking_action_categories
where name = 'other'
union all
select id, 'spread', 'Distribute evenly over surface', 'Use offset spatula for even spreading'
from cooking_action_categories
where name = 'other'
union all
select id, 'coat', 'Cover surface', 'Ensure even coating on all sides'
from cooking_action_categories
where name = 'other'
union all
select id, 'dip', 'Briefly submerge', 'Dip quickly and let excess drip off'
from cooking_action_categories
where name = 'other'
union all
select id, 'baste', 'Moisten during cooking', 'Keeps food moist and adds flavor'
from cooking_action_categories
where name = 'other'
union all
select id, 'flip', 'Turn over', 'Use spatula or tongs to flip carefully'
from cooking_action_categories
where name = 'other'
union all
select id, 'turn', 'Rotate position', 'Ensures even cooking on all sides'
from cooking_action_categories
where name = 'other'
union all
select id, 'rotate', 'Turn around axis', 'Rotate pan or food for even heat distribution'
from cooking_action_categories
where name = 'other'
union all
select id, 'shake', 'Move rapidly back and forth', 'Prevents sticking and ensures even coating'
from cooking_action_categories
where name = 'other'
on conflict (name) do nothing;

-- Seed cooking action aliases for common synonyms
insert into cooking_action_aliases (action_id, alias)
select id, 'chop finely'
from cooking_actions
where name = 'mince'
union all
select id, 'finely chop'
from cooking_actions
where name = 'mince'
union all
select id, 'cut into small cubes'
from cooking_actions
where name = 'dice'
union all
select id, 'cut into strips'
from cooking_actions
where name = 'julienne'
union all
select id, 'cut into matchsticks'
from cooking_actions
where name = 'julienne'
union all
select id, 'thinly slice'
from cooking_actions
where name = 'slice'
union all
select id, 'remove skin'
from cooking_actions
where name = 'peel'
union all
select id, 'shred finely'
from cooking_actions
where name = 'grate'
union all
select id, 'stir together'
from cooking_actions
where name = 'mix'
union all
select id, 'mix together'
from cooking_actions
where name = 'mix'
union all
select id, 'whisk together'
from cooking_actions
where name = 'whisk'
union all
select id, 'beat together'
from cooking_actions
where name = 'beat'
union all
select id, 'gently fold'
from cooking_actions
where name = 'fold'
union all
select id, 'fold in'
from cooking_actions
where name = 'fold'
union all
select id, 'toss to combine'
from cooking_actions
where name = 'toss'
union all
select id, 'cook in oven'
from cooking_actions
where name = 'bake'
union all
select id, 'oven bake'
from cooking_actions
where name = 'bake'
union all
select id, 'oven roast'
from cooking_actions
where name = 'roast'
union all
select id, 'cook on grill'
from cooking_actions
where name = 'grill'
union all
select id, 'grill over high heat'
from cooking_actions
where name = 'grill'
union all
select id, 'pan fry'
from cooking_actions
where name = 'pan_fry'
union all
select id, 'panfry'
from cooking_actions
where name = 'pan_fry'
union all
select id, 'deep fry'
from cooking_actions
where name = 'deep_fry'
union all
select id, 'deepfry'
from cooking_actions
where name = 'deep_fry'
union all
select id, 'stir fry'
from cooking_actions
where name = 'stir_fry'
union all
select id, 'stirfry'
from cooking_actions
where name = 'stir_fry'
union all
select id, 'cook in pan'
from cooking_actions
where name = 'sauté'
union all
select id, 'saute'
from cooking_actions
where name = 'sauté'
union all
select id, 'bring to boil'
from cooking_actions
where name = 'boil'
union all
select id, 'bring to a boil'
from cooking_actions
where name = 'boil'
union all
select id, 'cook at low heat'
from cooking_actions
where name = 'simmer'
union all
select id, 'gently simmer'
from cooking_actions
where name = 'simmer'
union all
select id, 'steam cook'
from cooking_actions
where name = 'steam'
union all
select id, 'slow cook in liquid'
from cooking_actions
where name = 'braise'
union all
select id, 'heat oven'
from cooking_actions
where name = 'preheat'
union all
select id, 'preheat oven'
from cooking_actions
where name = 'preheat'
union all
select id, 'let cool'
from cooking_actions
where name = 'cool'
union all
select id, 'cool down'
from cooking_actions
where name = 'cool'
union all
select id, 'refrigerate'
from cooking_actions
where name = 'chill'
union all
select id, 'place in fridge'
from cooking_actions
where name = 'chill'
union all
select id, 'bring to room temperature'
from cooking_actions
where name = 'rest'
union all
select id, 'let rest'
from cooking_actions
where name = 'rest'
union all
select id, 'defrost'
from cooking_actions
where name = 'thaw'
union all
select id, 'unfreeze'
from cooking_actions
where name = 'thaw'
union all
select id, 'sprinkle on top'
from cooking_actions
where name = 'sprinkle'
union all
select id, 'sprinkle over'
from cooking_actions
where name = 'sprinkle'
union all
select id, 'drizzle over'
from cooking_actions
where name = 'drizzle'
union all
select id, 'drizzle on top'
from cooking_actions
where name = 'drizzle'
union all
select id, 'brush with'
from cooking_actions
where name = 'brush'
union all
select id, 'brush on'
from cooking_actions
where name = 'brush'
union all
select id, 'place on top'
from cooking_actions
where name = 'top'
union all
select id, 'top with'
from cooking_actions
where name = 'top'
union all
select id, 'add to top'
from cooking_actions
where name = 'top'
union all
select id, 'put on plate'
from cooking_actions
where name = 'plate'
union all
select id, 'arrange on plate'
from cooking_actions
where name = 'plate'
union all
select id, 'cut in half'
from cooking_actions
where name = 'halve'
union all
select id, 'split in half'
from cooking_actions
where name = 'halve'
union all
select id, 'cut into quarters'
from cooking_actions
where name = 'quarter'
union all
select id, 'divide into quarters'
from cooking_actions
where name = 'quarter'
union all
select id, 'move to'
from cooking_actions
where name = 'transfer'
union all
select id, 'transfer to'
from cooking_actions
where name = 'transfer'
union all
select id, 'put aside'
from cooking_actions
where name = 'set_aside'
union all
select id, 'set aside'
from cooking_actions
where name = 'set_aside'
union all
select id, 'keep aside'
from cooking_actions
where name = 'reserve'
union all
select id, 'save for later'
from cooking_actions
where name = 'reserve'
union all
select id, 'remove from pan'
from cooking_actions
where name = 'remove'
union all
select id, 'take out'
from cooking_actions
where name = 'remove'
union all
select id, 'throw away'
from cooking_actions
where name = 'discard'
union all
select id, 'get rid of'
from cooking_actions
where name = 'discard'
union all
select id, 'pour off'
from cooking_actions
where name = 'drain'
union all
select id, 'drain liquid'
from cooking_actions
where name = 'drain'
union all
select id, 'run through strainer'
from cooking_actions
where name = 'strain'
union all
select id, 'pass through strainer'
from cooking_actions
where name = 'strain'
union all
select id, 'blend smooth'
from cooking_actions
where name = 'puree'
union all
select id, 'blend until smooth'
from cooking_actions
where name = 'puree'
union all
select id, 'break open'
from cooking_actions
where name = 'crack'
union all
select id, 'crack open'
from cooking_actions
where name = 'crack'
union all
select id, 'remove pit'
from cooking_actions
where name = 'pit'
union all
select id, 'take out pit'
from cooking_actions
where name = 'pit'
union all
select id, 'remove core'
from cooking_actions
where name = 'core'
union all
select id, 'take out core'
from cooking_actions
where name = 'core'
union all
select id, 'remove seeds'
from cooking_actions
where name = 'seed'
union all
select id, 'take out seeds'
from cooking_actions
where name = 'seed'
union all
select id, 'flip over'
from cooking_actions
where name = 'flip'
union all
select id, 'turn over'
from cooking_actions
where name = 'flip'
union all
select id, 'turn around'
from cooking_actions
where name = 'rotate'
union all
select id, 'rotate pan'
from cooking_actions
where name = 'rotate'
union all
select id, 'check flavor'
from cooking_actions
where name = 'taste'
union all
select id, 'taste and adjust'
from cooking_actions
where name = 'adjust'
union all
select id, 'adjust seasoning'
from cooking_actions
where name = 'adjust'
union all
select id, 'add seasoning'
from cooking_actions
where name = 'season'
union all
select id, 'season to taste'
from cooking_actions
where name = 'season'
union all
select id, 'soak in marinade'
from cooking_actions
where name = 'marinate'
union all
select id, 'let marinate'
from cooking_actions
where name = 'marinate'
union all
select id, 'place in fridge'
from cooking_actions
where name = 'refrigerate'
union all
select id, 'put in refrigerator'
from cooking_actions
where name = 'refrigerate'
union all
select id, 'place in freezer'
from cooking_actions
where name = 'freeze'
union all
select id, 'put in freezer'
from cooking_actions
where name = 'freeze'
on conflict (alias) do nothing;
