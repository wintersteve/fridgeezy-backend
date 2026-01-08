import { supabase } from "@/src/shared/supabase";

export interface Tags {
    component: string[];
    dietary: string[];
    cuisine: string[];
}

// Simple in-memory cache
let cachedTags: Tags | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchTagsCached(): Promise<Tags> {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedTags && now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedTags;
    }

    // Fetch canonical tags
    const { data: canonicalTags, error: tagsError } = await supabase
        .from("tags")
        .select("name, type")
        .order("name");

    if (tagsError) {
        // If we have stale cache, return it on error
        if (cachedTags) {
            return cachedTags;
        }
        throw new Error(`Failed to fetch tags: ${tagsError.message}`);
    }

    // Fetch aliases
    const { data: aliases, error: aliasesError } = await supabase
        .from("tag_aliases")
        .select("alias, type")
        .order("alias");

    if (aliasesError) {
        // If we have stale cache, return it on error
        if (cachedTags) {
            return cachedTags;
        }
        throw new Error(`Failed to fetch tag aliases: ${aliasesError.message}`);
    }

    const result: Tags = { component: [], dietary: [], cuisine: [] };

    // Add canonical tags
    for (const tag of canonicalTags ?? []) {
        if (tag.type === "component") {
            result.component.push(tag.name);
        } else if (tag.type === "dietary") {
            result.dietary.push(tag.name);
        } else if (tag.type === "cuisine") {
            result.cuisine.push(tag.name);
        }
    }

    // Add aliases
    for (const alias of aliases ?? []) {
        if (alias.type === "component") {
            result.component.push(alias.alias);
        } else if (alias.type === "dietary") {
            result.dietary.push(alias.alias);
        } else if (alias.type === "cuisine") {
            result.cuisine.push(alias.alias);
        }
    }

    // Update cache
    cachedTags = result;
    cacheTimestamp = now;

    return result;
}

// For testing or manual cache invalidation
export function invalidateTagsCache(): void {
    cachedTags = null;
    cacheTimestamp = 0;
}
