/**
 * The closed, curated ingredient-category vocabulary — the canonical_ids of the
 * seeded `categories` table. Recipe-generation prompts constrain the LLM's
 * ingredient `category` field to these ids so persist_recipe resolves them
 * directly (it no longer creates categories on the fly).
 */
export const INGREDIENT_CATEGORY_IDS = [
    "meats",
    "seafood",
    "eggs",
    "dairy",
    "vegetables",
    "fruits",
    "grains",
    "legumes",
    "nuts_seeds",
    "herbs_spices",
    "mushrooms",
    "noodles",
    "breads",
    "fats_oils",
    "sweeteners",
    "stocks",
    "sauces",
    "vinegars",
    "beverages",
    "baking",
] as const;

/** Prompt-ready list of the category ids with short glosses. */
export const INGREDIENT_CATEGORY_GUIDE = `- meats: red meat, poultry, game, cured meats
- seafood: fish, shellfish, crustaceans
- eggs: eggs of any bird
- dairy: milk, cream, yogurt, butter, cheese
- vegetables: all vegetables including roots, greens, alliums, peppers
- fruits: fresh and dried fruit, berries
- grains: rice, quinoa, oats, wheat, barley, couscous
- legumes: beans, lentils, peas, chickpeas, soy products
- nuts_seeds: tree nuts, peanuts, seeds, nut/seed butters
- herbs_spices: fresh/dried herbs, spices, seasonings
- mushrooms: all fungi
- noodles: pasta and Asian noodles
- breads: bread, tortillas, pita, wraps, crackers, crumbs
- fats_oils: cooking oils and solid fats
- sweeteners: sugar, honey, syrups
- stocks: broths, stocks, bouillon
- sauces: sauces, condiments, pastes, dressings
- vinegars: all vinegars
- beverages: cooking wines/spirits, juices, plant milks, coffee/tea
- baking: flour, leaveners, chocolate, extracts`;
