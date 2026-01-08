import { supabase } from "@/src/shared/supabase";

// Cache for category name -> ID lookups (5 minute TTL)
const categoryCache = new Map<string, { id: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getIdByName = async (name: string): Promise<string | null> => {
    // Check cache first
    const cached = categoryCache.get(name.toLowerCase());
    if (cached && cached.expiresAt > Date.now()) {
        return cached.id;
    }

    const { data, error } = await supabase
        .from("categories")
        .select("id")
        .eq("name", name.toLowerCase())
        .single();

    if (error || !data) {
        console.error(`Category not found: ${name}`, error);
        return null;
    }

    // Cache the result
    categoryCache.set(name.toLowerCase(), {
        id: data.id,
        expiresAt: Date.now() + CACHE_TTL,
    });

    return data.id;
};

const getAll = async () => {
    return supabase.from("categories").select("*").order("name");
};

export const CategoriesRepo = {
    getIdByName,
    getAll,
};
