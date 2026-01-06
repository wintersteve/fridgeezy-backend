import { supabase } from "@/src/shared/supabase";

export interface Unit {
    abbreviation: string;
    id: string;
    name: string;
    type: string;
}

// Simple in-memory cache
let cachedUnits: Unit[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches units from Supabase (metric and universal only).
 * Results are cached for 5 minutes.
 */
export async function fetchUnitsCached(): Promise<Unit[]> {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedUnits && now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedUnits;
    }

    // Fetch fresh data - only metric and universal units
    const { data, error } = await supabase
        .from("units")
        .select("id, abbreviation, name, type")
        .in("system", ["metric", "universal"])
        .order("type")
        .order("name");

    if (error) {
        // If we have stale cache, return it on error
        if (cachedUnits) {
            return cachedUnits;
        }
        throw new Error(`Failed to fetch units: ${error.message}`);
    }

    const result: Unit[] = (data ?? []).map((u) => ({
        abbreviation: u.abbreviation,
        id: u.id,
        name: u.name,
        type: u.type,
    }));

    // Update cache
    cachedUnits = result;
    cacheTimestamp = now;

    return result;
}

// For testing or manual cache invalidation
export function invalidateUnitsCache(): void {
    cachedUnits = null;
    cacheTimestamp = 0;
}
