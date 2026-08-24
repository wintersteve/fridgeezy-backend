import { IngredientsRepository, supabaseAdmin } from "@fridgeezy/supabase";
import { ingredientCanonicalId, splitIngredientName } from "@fridgeezy/toolkit";

/** A catalogue row as returned by `find_recipes`, narrowed to what chat needs. */
export interface CatalogueRecipe {
    id: string;
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    /** Hero image. Always null for suggestion rows — they have no recipe yet. */
    image: string | null;
    /** `recipe` rows are already generated; `suggestion` rows still need it. */
    source: "recipe" | "suggestion";
    /**
     * Total minutes, for the time pill. Derived from prep + cook on a recipe
     * row, the generator's estimate on a suggestion row — `find_recipes` returns
     * whichever applies. Null on rows predating `20260812000004`.
     */
    totalTimeMinutes: number | null;
    ingredients: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string }>;
}

/**
 * Resolve ingredient NAMES to ids without writing anything.
 *
 * Deliberately not `matchIngredients`: that one exists for the persist path and
 * ends by CREATING any ingredient it can't match (plus an LLM adjudication for
 * the gray band). Searching for "chicken and rice" must never add rows to the
 * catalogue or pay for adjudication, so this stops at the two deterministic
 * lookups — canonical id, then alias — and simply drops what it can't resolve.
 *
 * An unresolved name dropping out is the right failure mode here: `find_recipes`
 * requires EVERY id it is given to be present, so a name we can't resolve would
 * otherwise guarantee zero results.
 */
export async function resolveIngredientIds(
    names: string[]
): Promise<string[]> {
    const cleaned = names
        .map((name) => splitIngredientName(name).name.trim())
        .filter((name) => name.length > 0);

    if (cleaned.length === 0) return [];

    const repository = new IngredientsRepository();
    const ids: string[] = [];
    const unresolved: string[] = [];

    const byCanonical = await repository.findByCanonicalIds(
        cleaned.map((name) => ingredientCanonicalId(name))
    );

    for (const name of cleaned) {
        const match = byCanonical.success
            ? byCanonical.value.get(ingredientCanonicalId(name))
            : undefined;

        if (match) {
            ids.push(match.id);
        } else {
            unresolved.push(name);
        }
    }

    if (unresolved.length > 0) {
        // Keyed on the canonical form, like the persist path. The hand-rolled
        // `.toLowerCase()` this replaces was a partial workaround for the same
        // case-sensitivity defect and only covered names that differed by case
        // alone — a plural ("Green Onions") or a punctuation variant still fell
        // through, which here means silently dropping a search term.
        const byAlias = await repository.findByAliasCanonicalIds(
            unresolved.map((name) => ingredientCanonicalId(name))
        );

        if (byAlias.success) {
            for (const name of unresolved) {
                const target = byAlias.value.get(ingredientCanonicalId(name));
                if (target) ids.push(target.id);
            }
        }
    }

    return [...new Set(ids)];
}

/**
 * The catalogue lookup the SEARCH SCREEN uses, made available to chat.
 *
 * Chat's other two lookups are an exact-name match and a vector search over the
 * dish signature, and neither can answer "what can I make with chicken and
 * rice?" — measured, an ingredient question scores ~0.43 against even the right
 * dish, far below anything a similarity gate can safely accept. `find_recipes`
 * answers it exactly, by ingredient id, with no similarity involved, and returns
 * suggestions alongside recipes the same way the search screen sees them.
 *
 * Never throws: an empty list just means chat falls through to generating, which
 * is what it did before this path existed.
 */
export async function findCatalogueRecipes(options: {
    ingredients: string[];
    blacklist?: string[];
    difficulty?: "easy" | "medium" | "hard";
    limit?: number;
}): Promise<CatalogueRecipe[]> {
    const { ingredients, blacklist = [], difficulty, limit = 5 } = options;

    try {
        const ingredientIds = await resolveIngredientIds(ingredients);

        // With no resolvable ingredient this degenerates into "any recipe at
        // all", which is not what the user asked for — leave it to the other
        // stages.
        if (ingredientIds.length === 0) return [];

        const blacklistIds = blacklist.length
            ? await resolveIngredientIds(blacklist)
            : [];

        const { data, error } = await supabaseAdmin.rpc("find_recipes", {
            ingredients: ingredientIds,
            blacklist: blacklistIds,
            limit_count: limit,
            ...(difficulty ? { p_difficulty: difficulty } : {}),
        });

        if (error) {
            console.error(
                "[FindCatalogueRecipes] find_recipes failed:",
                error.message
            );
            return [];
        }

        return (data ?? []).map((row) => ({
            id: row.id as string,
            name: row.name as string,
            description: (row.short_description || row.description || "") as string,
            image: (row.image as string | null) ?? null,
            difficulty: row.difficulty as "easy" | "medium" | "hard",
            source: row.source === "recipe" ? "recipe" : "suggestion",
            totalTimeMinutes: (row.total_time_minutes as number | null) ?? null,
            ingredients: toNamedRows(row.ingredients),
            tags: toNamedRows(row.tags),
        }));
    } catch (error) {
        console.error("[FindCatalogueRecipes] lookup failed:", error);
        return [];
    }
}

/**
 * `find_recipes` hands ingredients/tags back as jsonb arrays of {id, name}.
 *
 * Exported for `fetch-menu-pairings`, which decodes the identical shape out of
 * `menu_pairings_for_recipe` — the two RPCs build those aggregates with the same
 * `jsonb_build_object('id', …, 'name', …)`, so they get the same decoder rather
 * than a second one that could drift.
 */
export function toNamedRows(value: unknown): Array<{ id: string; name: string }> {
    if (!Array.isArray(value)) return [];

    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const { id, name } = entry as { id?: unknown; name?: unknown };
        if (typeof id !== "string" || typeof name !== "string") return [];
        return [{ id, name }];
    });
}
