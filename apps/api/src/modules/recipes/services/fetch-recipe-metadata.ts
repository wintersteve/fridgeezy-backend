import { supabaseAdmin } from "@fridgeezy/supabase";

interface RecipeMetadata {
    units: Array<{ abbreviation: string; type: string }>;
    tags: Array<{ name: string; type: string }>;
}

/**
 * Fetches recipe metadata (units and tags) from Supabase
 * This data is used to enrich the AI prompt with valid options
 */
export async function fetchRecipeMetadata(): Promise<RecipeMetadata> {
    // Fetch all units
    const { data: units, error: unitsError } = await supabaseAdmin
        .from("units")
        .select("abbreviation, type")
        .order("type");

    if (unitsError) {
        console.error("Error fetching units:", unitsError);
        throw new Error(`Failed to fetch units: ${unitsError.message}`);
    }

    // Fetch all canonical tags (where name = canonical_id or canonical_id is not null)
    const { data: tags, error: tagsError } = await supabaseAdmin
        .from("tags")
        .select("name, type")
        .order("type");

    if (tagsError) {
        console.error("Error fetching tags:", tagsError);
        throw new Error(`Failed to fetch tags: ${tagsError.message}`);
    }

    return {
        units: units || [],
        tags: tags || [],
    };
}

/**
 * Format units grouped by type for the prompt
 */
export function formatUnitsForPrompt(
    units: Array<{ abbreviation: string; type: string }>
): string {
    const grouped = units.reduce(
        (acc, unit) => {
            if (!acc[unit.type]) acc[unit.type] = [];
            acc[unit.type].push(unit.abbreviation);
            return acc;
        },
        {} as Record<string, string[]>
    );

    return Object.entries(grouped)
        .map(([type, abbrevs]) => `${type} units: ${abbrevs.join(", ")}`)
        .join("\n");
}

/**
 * Format tags grouped by type for the prompt
 */
export function formatTagsForPrompt(
    tags: Array<{ name: string; type: string }>
): string {
    const grouped = tags.reduce(
        (acc, tag) => {
            if (!acc[tag.type]) acc[tag.type] = [];
            acc[tag.type].push(tag.name);
            return acc;
        },
        {} as Record<string, string[]>
    );

    return Object.entries(grouped)
        .map(([type, names]) => `${type}: ${names.join(", ")}`)
        .join("\n\n");
}
