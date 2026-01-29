import { config } from "dotenv";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Types
interface NutritionalInfo {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sodium: number;
    serving_size: string;
}

interface Ingredient {
    name: string;
    category: string;
    parent?: string;
    description: string;
    shelf_life: string;
    storage_tips: string;
    nutritional_info: NutritionalInfo;
    expires_by_default: boolean;
    default_shelf_life_days: number | null;
}

interface Pairing {
    ingredient1: string;
    ingredient2: string;
    notes: string;
}

interface Substitute {
    ingredient: string;
    substitute: string;
    notes: string;
}

// Categories from the database
const CATEGORIES = [
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
];

// Target counts per category for ~1000 total ingredients
const CATEGORY_TARGETS: Record<string, number> = {
    meats: 80,
    seafood: 100,
    eggs: 15,
    dairy: 70,
    vegetables: 150,
    fruits: 80,
    grains: 50,
    legumes: 40,
    nuts_seeds: 45,
    herbs_spices: 120,
    mushrooms: 25,
    noodles: 35,
    breads: 30,
    fats_oils: 35,
    sweeteners: 25,
    stocks: 15,
    sauces: 60,
    vinegars: 20,
    beverages: 40,
    baking: 40,
};

// Helper to delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate ingredients for a category using GPT-4o
async function generateIngredientsForCategory(
    category: string,
    count: number
): Promise<Ingredient[]> {
    console.log(`\nGenerating ${count} ingredients for category: ${category}`);

    const prompt = `Generate exactly ${count} ingredients for the "${category}" category for a recipe app database.

Focus on the most commonly used ingredients globally, including:
- Western cuisine staples
- Asian cuisine essentials (Chinese, Japanese, Korean, Thai, Vietnamese, Indian)
- Mediterranean and Middle Eastern ingredients
- Latin American ingredients
- African ingredients

For each ingredient, provide:
1. name: lowercase with underscores (e.g., "chicken_breast", "soy_sauce")
2. category: "${category}"
3. parent: optional parent ingredient name if this is a variant (e.g., "chicken" for "chicken_breast")
4. description: brief 1-2 sentence description
5. shelf_life: storage duration (e.g., "3-5 days refrigerated, 6-12 months frozen")
6. storage_tips: how to store properly
7. nutritional_info: per 100g with calories, protein, carbs, fat, fiber, sodium (in mg), serving_size: "100g"
8. expires_by_default: true for perishables (meat, dairy, produce), false for shelf-stable items
9. default_shelf_life_days: number of days until expiration (only if expires_by_default is true, otherwise null)

Return as a JSON array of objects. Be comprehensive and include both common and specialty items.
Include regional varieties where relevant (e.g., different types of rice, different cuts of meat).`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a culinary expert and food scientist. Generate accurate, comprehensive ingredient data for a recipe database. Always return valid JSON.",
                },
                { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("Empty response from GPT-4o");

        const parsed = JSON.parse(content);
        const ingredients: Ingredient[] = parsed.ingredients || parsed;

        console.log(`  Generated ${ingredients.length} ingredients`);
        return ingredients;
    } catch (error) {
        console.error(`  Error generating ingredients for ${category}:`, error);
        return [];
    }
}

// Generate pairings using GPT-4o
async function generatePairings(
    ingredientNames: string[]
): Promise<Pairing[]> {
    console.log("\nGenerating ingredient pairings...");

    const allPairings: Pairing[] = [];

    // Process in batches to avoid token limits
    const batchSize = 200;
    for (let i = 0; i < ingredientNames.length; i += batchSize) {
        const batch = ingredientNames.slice(i, i + batchSize);
        console.log(
            `  Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ingredientNames.length / batchSize)}`
        );

        const prompt = `Given these ingredients: ${batch.join(", ")}

Generate classic and popular ingredient pairings. Focus on:
- Classic culinary combinations (tomato + basil, lamb + rosemary)
- Regional cuisine pairings (soy_sauce + ginger + garlic for Asian)
- Flavor profile matches (sweet + salt, acid + fat)
- Complementary textures

Generate 50-80 pairings for this batch. Each pairing should have:
1. ingredient1: first ingredient name (must be from the list)
2. ingredient2: second ingredient name (must be from the list)
3. notes: brief explanation of why they pair well

Return as JSON with a "pairings" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate accurate ingredient pairings based on established culinary traditions. Return valid JSON.",
                    },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const pairings: Pairing[] = parsed.pairings || [];
                allPairings.push(...pairings);
                console.log(`    Generated ${pairings.length} pairings`);
            }
        } catch (error) {
            console.error(`  Error generating pairings:`, error);
        }

        await delay(1000); // Rate limiting
    }

    // Generate cross-category pairings
    console.log("  Generating cross-category pairings...");
    const crossCategoryPrompt = `Generate 500 classic cross-category ingredient pairings from this list: ${ingredientNames.slice(0, 500).join(", ")}

Focus on fundamental pairings that work across cuisines:
- Protein + aromatic (chicken + garlic, beef + onion)
- Protein + herb (lamb + rosemary, fish + dill)
- Starch + sauce (pasta + tomato_sauce, rice + soy_sauce)
- Vegetable + fat (potato + butter, salad + olive_oil)
- Fruit + dairy (strawberry + cream, apple + cheddar)

Each pairing needs:
1. ingredient1: first ingredient name
2. ingredient2: second ingredient name
3. notes: why they work together

Return as JSON with a "pairings" array.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a culinary expert. Generate classic ingredient pairings. Return valid JSON.",
                },
                { role: "user", content: crossCategoryPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 16000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            const pairings: Pairing[] = parsed.pairings || [];
            allPairings.push(...pairings);
            console.log(`    Generated ${pairings.length} cross-category pairings`);
        }
    } catch (error) {
        console.error(`  Error generating cross-category pairings:`, error);
    }

    console.log(`  Total pairings generated: ${allPairings.length}`);
    return allPairings;
}

// Generate substitutes using GPT-4o
async function generateSubstitutes(
    ingredientNames: string[]
): Promise<Substitute[]> {
    console.log("\nGenerating ingredient substitutes...");

    const allSubstitutes: Substitute[] = [];

    // Process common substitution categories
    const substitutionCategories = [
        {
            name: "dairy",
            ingredients: ingredientNames.filter((n) =>
                ["milk", "cream", "butter", "yogurt", "cheese", "sour_cream"].some(
                    (d) => n.includes(d)
                )
            ),
        },
        {
            name: "proteins",
            ingredients: ingredientNames.filter((n) =>
                [
                    "chicken",
                    "beef",
                    "pork",
                    "turkey",
                    "lamb",
                    "fish",
                    "tofu",
                    "tempeh",
                ].some((p) => n.includes(p))
            ),
        },
        {
            name: "grains",
            ingredients: ingredientNames.filter((n) =>
                ["rice", "pasta", "noodle", "flour", "bread", "quinoa", "oat"].some(
                    (g) => n.includes(g)
                )
            ),
        },
        {
            name: "fats",
            ingredients: ingredientNames.filter((n) =>
                ["oil", "butter", "ghee", "lard"].some((f) => n.includes(f))
            ),
        },
        {
            name: "sweeteners",
            ingredients: ingredientNames.filter((n) =>
                ["sugar", "honey", "maple", "agave", "syrup"].some((s) =>
                    n.includes(s)
                )
            ),
        },
        {
            name: "acids",
            ingredients: ingredientNames.filter((n) =>
                ["vinegar", "lemon", "lime", "citrus"].some((a) => n.includes(a))
            ),
        },
        {
            name: "alliums",
            ingredients: ingredientNames.filter((n) =>
                ["onion", "garlic", "shallot", "leek", "scallion", "chive"].some(
                    (a) => n.includes(a)
                )
            ),
        },
        {
            name: "herbs",
            ingredients: ingredientNames.filter((n) =>
                [
                    "basil",
                    "parsley",
                    "cilantro",
                    "oregano",
                    "thyme",
                    "rosemary",
                    "mint",
                    "dill",
                ].some((h) => n.includes(h))
            ),
        },
    ];

    for (const category of substitutionCategories) {
        if (category.ingredients.length < 2) continue;

        console.log(
            `  Generating substitutes for ${category.name} (${category.ingredients.length} ingredients)`
        );

        const prompt = `For these ${category.name} ingredients: ${category.ingredients.join(", ")}

Generate practical cooking substitutions. For each substitution provide:
1. ingredient: the original ingredient
2. substitute: what can replace it
3. notes: ratio/amount adjustments and any flavor/texture differences

Focus on:
- Direct substitutes (same category swaps)
- Dietary alternatives (vegan, dairy-free, gluten-free options)
- Emergency substitutes (common pantry swaps)

Generate 30-50 substitutions. Return as JSON with a "substitutes" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate practical ingredient substitutions with accurate ratios. Return valid JSON.",
                    },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const substitutes: Substitute[] = parsed.substitutes || [];
                allSubstitutes.push(...substitutes);
                console.log(`    Generated ${substitutes.length} substitutes`);
            }
        } catch (error) {
            console.error(
                `  Error generating substitutes for ${category.name}:`,
                error
            );
        }

        await delay(1000);
    }

    // Generate general substitutes
    console.log("  Generating general substitutes...");
    const generalPrompt = `From this ingredient list: ${ingredientNames.slice(0, 400).join(", ")}

Generate 200 practical cooking substitutions covering:
- Common allergen alternatives
- Vegan/vegetarian swaps
- Low-sodium alternatives
- Budget-friendly substitutes
- Regional ingredient alternatives

Each needs:
1. ingredient: original ingredient name
2. substitute: replacement ingredient name
3. notes: how to substitute (ratios, cooking adjustments)

Return as JSON with a "substitutes" array.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a culinary expert. Generate practical substitutions. Return valid JSON.",
                },
                { role: "user", content: generalPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 16000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            const substitutes: Substitute[] = parsed.substitutes || [];
            allSubstitutes.push(...substitutes);
            console.log(`    Generated ${substitutes.length} general substitutes`);
        }
    } catch (error) {
        console.error(`  Error generating general substitutes:`, error);
    }

    console.log(`  Total substitutes generated: ${allSubstitutes.length}`);
    return allSubstitutes;
}

// Generate embeddings for all ingredients
async function generateEmbeddings(
    ingredients: Ingredient[]
): Promise<Map<string, number[]>> {
    console.log("\nGenerating embeddings for ingredients...");

    const embeddings = new Map<string, number[]>();
    const batchSize = 500; // OpenAI limit is 2048, but smaller batches are safer

    for (let i = 0; i < ingredients.length; i += batchSize) {
        const batch = ingredients.slice(i, i + batchSize);
        console.log(
            `  Processing embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ingredients.length / batchSize)}`
        );

        const texts = batch.map((ing) => `${ing.name}: ${ing.description}`);

        try {
            const response = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: texts,
                dimensions: 1536,
            });

            response.data.forEach((item, index) => {
                embeddings.set(batch[index].name, item.embedding);
            });

            console.log(`    Generated ${response.data.length} embeddings`);
            console.log(`    Tokens used: ${response.usage.total_tokens}`);
        } catch (error) {
            console.error(`  Error generating embeddings:`, error);
        }

        await delay(500);
    }

    console.log(`  Total embeddings generated: ${embeddings.size}`);
    return embeddings;
}

// Escape SQL string
function escapeSql(str: string): string {
    return str.replace(/'/g, "''");
}

// Generate ingredients SQL
function generateIngredientsSql(
    ingredients: Ingredient[],
    embeddings: Map<string, number[]>
): string {
    const lines: string[] = [
        "-- Generated ingredient seeds with ~1000 ingredients",
        "-- Includes nutritional info, shelf life, and embeddings",
        "",
        "DO",
        "$$",
        "declare",
    ];

    // Declare category variables
    CATEGORIES.forEach((cat) => {
        lines.push(`    cat_${cat} UUID;`);
    });

    lines.push("begin");

    // Get category IDs
    CATEGORIES.forEach((cat) => {
        lines.push(
            `    select id into cat_${cat} from categories where name = '${cat}';`
        );
    });

    lines.push("");

    // Group ingredients by category
    const byCategory = new Map<string, Ingredient[]>();
    ingredients.forEach((ing) => {
        const list = byCategory.get(ing.category) || [];
        list.push(ing);
        byCategory.set(ing.category, list);
    });

    // Generate inserts for each category
    for (const [category, catIngredients] of byCategory) {
        lines.push(`-- ========== ${category.toUpperCase()} ==========`);
        lines.push("");

        // Insert in batches for readability
        const batchSize = 20;
        for (let i = 0; i < catIngredients.length; i += batchSize) {
            const batch = catIngredients.slice(i, i + batchSize);

            lines.push(
                "insert into ingredients (name, category_id, description, shelf_life, storage_tips, nutritional_info, expires_by_default, default_shelf_life_days, embedding)"
            );
            lines.push("values");

            const values = batch.map((ing, idx) => {
                const embedding = embeddings.get(ing.name);
                const embeddingStr = embedding
                    ? `'[${embedding.join(",")}]'`
                    : "NULL";

                const nutritionalJson = JSON.stringify(ing.nutritional_info);
                const shelfLifeDays =
                    ing.expires_by_default && ing.default_shelf_life_days
                        ? ing.default_shelf_life_days
                        : "NULL";

                const comma = idx === batch.length - 1 ? "" : ",";

                return `       ('${escapeSql(ing.name)}', cat_${category}, '${escapeSql(ing.description)}', '${escapeSql(ing.shelf_life)}', '${escapeSql(ing.storage_tips)}', '${escapeSql(nutritionalJson)}'::jsonb, ${ing.expires_by_default}, ${shelfLifeDays}, ${embeddingStr})${comma}`;
            });

            lines.push(...values);
            lines.push("on CONFLICT (name) DO UPDATE SET");
            lines.push("    description = EXCLUDED.description,");
            lines.push("    shelf_life = EXCLUDED.shelf_life,");
            lines.push("    storage_tips = EXCLUDED.storage_tips,");
            lines.push("    nutritional_info = EXCLUDED.nutritional_info,");
            lines.push("    expires_by_default = EXCLUDED.expires_by_default,");
            lines.push("    default_shelf_life_days = EXCLUDED.default_shelf_life_days,");
            lines.push("    embedding = EXCLUDED.embedding;");
            lines.push("");
        }
    }

    // Generate parent relationships
    lines.push("-- ========== PARENT RELATIONSHIPS ==========");
    lines.push("");

    const parentRelations = ingredients.filter((ing) => ing.parent);
    const parentGroups = new Map<string, string[]>();
    parentRelations.forEach((ing) => {
        const children = parentGroups.get(ing.parent!) || [];
        children.push(ing.name);
        parentGroups.set(ing.parent!, children);
    });

    for (const [parent, children] of parentGroups) {
        lines.push("update ingredients");
        lines.push(
            `set parent_id = ( select id from ingredients where name = '${escapeSql(parent)}' )`
        );
        lines.push(
            `where name in (${children.map((c) => `'${escapeSql(c)}'`).join(", ")});`
        );
        lines.push("");
    }

    lines.push("end $$;");

    return lines.join("\n");
}

// Generate pairings SQL
function generatePairingsSql(
    pairings: Pairing[],
    ingredientNames: Set<string>
): string {
    // Filter to only include pairings where both ingredients exist
    const validPairings = pairings.filter(
        (p) => ingredientNames.has(p.ingredient1) && ingredientNames.has(p.ingredient2)
    );

    // Deduplicate pairings (keep unique pairs)
    const seen = new Set<string>();
    const uniquePairings = validPairings.filter((p) => {
        const key1 = `${p.ingredient1}|${p.ingredient2}`;
        const key2 = `${p.ingredient2}|${p.ingredient1}`;
        if (seen.has(key1) || seen.has(key2)) return false;
        seen.add(key1);
        return true;
    });

    const lines: string[] = [
        "-- Generated ingredient pairings",
        "-- Each pairing is inserted bidirectionally",
        "",
    ];

    // Generate inserts in batches
    const batchSize = 50;
    for (let i = 0; i < uniquePairings.length; i += batchSize) {
        const batch = uniquePairings.slice(i, i + batchSize);

        batch.forEach((p) => {
            lines.push(`-- ${p.ingredient1} <-> ${p.ingredient2}`);
            lines.push(
                "INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)"
            );
            lines.push("SELECT i1.id, i2.id, '" + escapeSql(p.notes) + "'");
            lines.push("FROM ingredients i1, ingredients i2");
            lines.push(
                `WHERE i1.name = '${escapeSql(p.ingredient1)}' AND i2.name = '${escapeSql(p.ingredient2)}'`
            );
            lines.push("ON CONFLICT DO NOTHING;");
            lines.push("");
            lines.push(
                "INSERT INTO ingredient_pairings (ingredient_id, paired_ingredient_id, notes)"
            );
            lines.push("SELECT i2.id, i1.id, '" + escapeSql(p.notes) + "'");
            lines.push("FROM ingredients i1, ingredients i2");
            lines.push(
                `WHERE i1.name = '${escapeSql(p.ingredient1)}' AND i2.name = '${escapeSql(p.ingredient2)}'`
            );
            lines.push("ON CONFLICT DO NOTHING;");
            lines.push("");
        });
    }

    return lines.join("\n");
}

// Generate substitutes SQL
function generateSubstitutesSql(
    substitutes: Substitute[],
    ingredientNames: Set<string>
): string {
    // Filter to only include substitutes where both ingredients exist
    const validSubstitutes = substitutes.filter(
        (s) =>
            ingredientNames.has(s.ingredient) && ingredientNames.has(s.substitute)
    );

    // Deduplicate
    const seen = new Set<string>();
    const uniqueSubstitutes = validSubstitutes.filter((s) => {
        const key = `${s.ingredient}|${s.substitute}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const lines: string[] = [
        "-- Generated ingredient substitutes",
        "-- Common cooking substitutions with notes",
        "",
    ];

    uniqueSubstitutes.forEach((s) => {
        lines.push(`-- ${s.ingredient} -> ${s.substitute}`);
        lines.push(
            "INSERT INTO ingredient_substitutes (ingredient_id, substitute_id, notes)"
        );
        lines.push(
            "SELECT i1.id, i2.id, '" + escapeSql(s.notes) + "'"
        );
        lines.push("FROM ingredients i1, ingredients i2");
        lines.push(
            `WHERE i1.name = '${escapeSql(s.ingredient)}' AND i2.name = '${escapeSql(s.substitute)}'`
        );
        lines.push("ON CONFLICT DO NOTHING;");
        lines.push("");
    });

    return lines.join("\n");
}

// Main function
async function main() {
    console.log("=".repeat(60));
    console.log("INGREDIENT SEED GENERATOR");
    console.log("=".repeat(60));
    console.log("\nThis script will generate ~1000 ingredients with:");
    console.log("- Nutritional information");
    console.log("- Shelf life and storage tips");
    console.log("- Parent-child relationships");
    console.log("- ~2000-3000 pairings");
    console.log("- ~500-1000 substitutes");
    console.log("- Embeddings (text-embedding-3-small)");
    console.log("");

    const startTime = Date.now();

    // Step 1: Generate ingredients for each category
    console.log("\n" + "=".repeat(40));
    console.log("STEP 1: GENERATING INGREDIENTS");
    console.log("=".repeat(40));

    const allIngredients: Ingredient[] = [];

    for (const category of CATEGORIES) {
        const count = CATEGORY_TARGETS[category] || 30;
        const ingredients = await generateIngredientsForCategory(category, count);
        allIngredients.push(...ingredients);
        await delay(2000); // Rate limiting between categories
    }

    console.log(`\nTotal ingredients generated: ${allIngredients.length}`);

    // Step 2: Generate embeddings
    console.log("\n" + "=".repeat(40));
    console.log("STEP 2: GENERATING EMBEDDINGS");
    console.log("=".repeat(40));

    const embeddings = await generateEmbeddings(allIngredients);

    // Step 3: Generate pairings
    console.log("\n" + "=".repeat(40));
    console.log("STEP 3: GENERATING PAIRINGS");
    console.log("=".repeat(40));

    const ingredientNames = allIngredients.map((i) => i.name);
    const pairings = await generatePairings(ingredientNames);

    // Step 4: Generate substitutes
    console.log("\n" + "=".repeat(40));
    console.log("STEP 4: GENERATING SUBSTITUTES");
    console.log("=".repeat(40));

    const substitutes = await generateSubstitutes(ingredientNames);

    // Step 5: Write SQL files
    console.log("\n" + "=".repeat(40));
    console.log("STEP 5: WRITING SQL FILES");
    console.log("=".repeat(40));

    const seedsDir = path.resolve(process.cwd(), "src/supabase/seeds");

    // Write ingredients SQL
    const ingredientsSql = generateIngredientsSql(allIngredients, embeddings);
    const ingredientsPath = path.join(seedsDir, "005_ingredients.sql");
    fs.writeFileSync(ingredientsPath, ingredientsSql);
    console.log(`\nWritten: ${ingredientsPath}`);
    console.log(`  Ingredients: ${allIngredients.length}`);

    // Write pairings SQL
    const ingredientNamesSet = new Set(ingredientNames);
    const pairingsSql = generatePairingsSql(pairings, ingredientNamesSet);
    const pairingsPath = path.join(seedsDir, "008_ingredient_pairings.sql");
    fs.writeFileSync(pairingsPath, pairingsSql);
    console.log(`\nWritten: ${pairingsPath}`);
    console.log(`  Pairings: ${pairings.length}`);

    // Write substitutes SQL
    const substitutesSql = generateSubstitutesSql(substitutes, ingredientNamesSet);
    const substitutesPath = path.join(seedsDir, "009_ingredient_substitutes.sql");
    fs.writeFileSync(substitutesPath, substitutesSql);
    console.log(`\nWritten: ${substitutesPath}`);
    console.log(`  Substitutes: ${substitutes.length}`);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log("GENERATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total ingredients: ${allIngredients.length}`);
    console.log(`Total pairings: ${pairings.length}`);
    console.log(`Total substitutes: ${substitutes.length}`);
    console.log(`Total embeddings: ${embeddings.size}`);
    console.log(`Time elapsed: ${elapsed} minutes`);
    console.log("");
    console.log("Next steps:");
    console.log("1. Review the generated SQL files");
    console.log("2. Run: nx run database:reset");
    console.log("3. Verify with: SELECT COUNT(*) FROM ingredients;");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
