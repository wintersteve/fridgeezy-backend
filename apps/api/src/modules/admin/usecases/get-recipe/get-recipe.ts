import type {
    AdminRecipeDetail,
    AdminRecipeReferences,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

/**
 * Everything on the recipe row except the two vectors.
 *
 * `fts` and any embedding are excluded by naming the rest: a 1536-float vector
 * serialised into JSON dwarfs the recipe it belongs to, and nothing in the
 * console can do anything with one.
 */
const DETAIL_COLUMNS = `
    id, name, name_en, description, short_description, image, difficulty,
    prep_time, cook_time, total_time_minutes, servings, tips, kcal, protein,
    carbs, fat, canonical_id, source_suggestion_id, thumbhash, favourite_count,
    origin, is_generated, is_personal, created_by, base_recipe_id,
    identity_cuisine, hidden_at, hidden_reason, created_at, updated_at
`;

/**
 * How many things a reader put somewhere that point at this dish.
 *
 * Five `head: true` counts rather than five reads — PostgREST answers those
 * with a `Content-Range` and no body, so this costs five index probes and
 * transfers nothing. They run together because they are independent and the
 * console waits on the slowest either way.
 *
 * It exists because hiding is "gone for everyone": a favourite, a planned night
 * or a shopping list pointing at a hidden dish resolves to nothing. The console
 * states the number and still allows the press — withdrawing a dish people
 * saved is sometimes precisely the intent, and a tool that refuses is one that
 * gets worked around with psql.
 */
async function countReferences(recipeId: string): Promise<AdminRecipeReferences> {
    const head = { count: "exact" as const, head: true };

    const [favourites, collections, shoppingLists, menuCourses, variants] =
        await Promise.all([
            supabaseAdmin
                .from("profile_recipe_interactions")
                .select("id", head)
                .eq("recipe_id", recipeId)
                .eq("interaction_type", "favourite"),
            supabaseAdmin
                .from("collection_recipes")
                .select("id", head)
                .eq("recipe_id", recipeId),
            supabaseAdmin
                .from("shopping_lists")
                .select("id", head)
                .eq("recipe_id", recipeId),
            supabaseAdmin
                .from("menu_courses")
                .select("id", head)
                .eq("recipe_id", recipeId),
            supabaseAdmin
                .from("recipe_variants")
                .select("id", head)
                .eq("base_recipe_id", recipeId),
        ]);

    return {
        favourites: favourites.count ?? 0,
        collections: collections.count ?? 0,
        shoppingLists: shoppingLists.count ?? 0,
        menuCourses: menuCourses.count ?? 0,
        variants: variants.count ?? 0,
    };
}

/**
 * `GET /rest/admin/recipes/:id` — one dish, in full, hidden or not.
 *
 * The embeds are PostgREST joins rather than four round trips. `units` is
 * reached THROUGH `recipe_ingredients.unit_id`, which is nullable — a recipe
 * ingredient with no unit ("2 eggs") is normal, so the embed is an outer join
 * and the console renders an absent unit rather than treating it as an error.
 */
export async function getRecipe(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const [recipe, ingredients, steps, tags, references] = await Promise.all([
        supabaseAdmin.from("recipes").select(DETAIL_COLUMNS).eq("id", id).maybeSingle(),
        supabaseAdmin
            .from("recipe_ingredients")
            .select("id, ingredient_id, quantity, unit_id, comment, ingredients(name), units(name)")
            .eq("recipe_id", id),
        supabaseAdmin
            .from("recipe_instructions")
            .select("id, step_number, instruction_text, title, duration_seconds, temperature_c, equipment, tips")
            .eq("recipe_id", id)
            .order("step_number", { ascending: true }),
        supabaseAdmin
            .from("recipe_tags")
            .select("tags(id, name, type)")
            .eq("recipe_id", id),
        countReferences(id),
    ]);

    if (recipe.error) {
        console.error("[admin] getRecipe failed", recipe.error);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!recipe.data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const row = recipe.data;

    const detail: AdminRecipeDetail = {
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        description: row.description,
        shortDescription: row.short_description,
        image: row.image,
        difficulty: row.difficulty,
        prepTime: row.prep_time,
        cookTime: row.cook_time,
        totalTimeMinutes: row.total_time_minutes,
        servings: row.servings,
        tips: row.tips,
        kcal: row.kcal,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        canonicalId: row.canonical_id,
        sourceSuggestionId: row.source_suggestion_id,
        thumbhash: row.thumbhash,
        favouriteCount: row.favourite_count,
        origin: row.origin,
        isGenerated: row.is_generated,
        isPersonal: row.is_personal,
        createdBy: row.created_by,
        baseRecipeId: row.base_recipe_id,
        identityCuisine: row.identity_cuisine,
        hiddenAt: row.hidden_at,
        hiddenReason: row.hidden_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ingredients: (ingredients.data ?? []).map((item) => ({
            id: item.id,
            ingredientId: item.ingredient_id,
            name: item.ingredients?.name ?? "Unknown ingredient",
            quantity: item.quantity,
            unitId: item.unit_id,
            unitName: item.units?.name ?? null,
            comment: item.comment,
        })),
        steps: (steps.data ?? []).map((step) => ({
            id: step.id,
            stepNumber: step.step_number,
            instructionText: step.instruction_text,
            title: step.title,
            durationSeconds: step.duration_seconds,
            temperatureC: step.temperature_c,
            equipment: step.equipment,
            tips: step.tips,
        })),
        tags: (tags.data ?? [])
            .map((link) => link.tags)
            .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
            .map((tag) => ({ id: tag.id, name: tag.name, type: tag.type })),
        references,
    };

    res.json(detail);
}
