-- Seed data for ingredient pairings
-- Each pairing is inserted bidirectionally (both directions)

-- Tomato ↔ Basil
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Classic Italian combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Tomato'
  AND i2.name = 'Basil'
UNION ALL
SELECT i2.id, i1.id, 'Classic Italian combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Tomato'
  AND i2.name = 'Basil';

-- Pasta ↔ Parmesan
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Traditional pasta topping'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Pasta'
  AND i2.name = 'Parmesan'
UNION ALL
SELECT i2.id, i1.id, 'Traditional pasta topping'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Pasta'
  AND i2.name = 'Parmesan';

-- Chicken ↔ Garlic
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Commonly used together in many cuisines'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Chicken'
  AND i2.name = 'Garlic'
UNION ALL
SELECT i2.id, i1.id, 'Commonly used together in many cuisines'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Chicken'
  AND i2.name = 'Garlic';

-- Lime ↔ Cilantro
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Popular in Mexican and Asian cuisines'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Lime'
  AND i2.name = 'Cilantro'
UNION ALL
SELECT i2.id, i1.id, 'Popular in Mexican and Asian cuisines'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Lime'
  AND i2.name = 'Cilantro';

-- Beef ↔ Onion
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Fundamental flavor pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Beef'
  AND i2.name = 'Onion'
UNION ALL
SELECT i2.id, i1.id, 'Fundamental flavor pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Beef'
  AND i2.name = 'Onion';

-- Rice ↔ Soy Sauce
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Classic Asian combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Rice'
  AND i2.name = 'Soy Sauce'
UNION ALL
SELECT i2.id, i1.id, 'Classic Asian combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Rice'
  AND i2.name = 'Soy Sauce';

-- Bread ↔ Butter
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Timeless pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Bread'
  AND i2.name = 'Butter'
UNION ALL
SELECT i2.id, i1.id, 'Timeless pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Bread'
  AND i2.name = 'Butter';

-- Strawberry ↔ Cream
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Classic dessert combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Strawberry'
  AND i2.name = 'Cream'
UNION ALL
SELECT i2.id, i1.id, 'Classic dessert combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Strawberry'
  AND i2.name = 'Cream';

-- Chocolate ↔ Vanilla
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Perfect dessert pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Chocolate'
  AND i2.name = 'Vanilla'
UNION ALL
SELECT i2.id, i1.id, 'Perfect dessert pairing'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Chocolate'
  AND i2.name = 'Vanilla';

-- Eggs ↔ Bacon
INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)
SELECT i1.id, i2.id, 'Classic breakfast combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Eggs'
  AND i2.name = 'Bacon'
UNION ALL
SELECT i2.id, i1.id, 'Classic breakfast combination'
FROM ingredients i1,
     ingredients i2
WHERE i1.name = 'Eggs'
  AND i2.name = 'Bacon';
