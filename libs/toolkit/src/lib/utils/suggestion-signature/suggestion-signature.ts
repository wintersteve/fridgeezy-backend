/**
 * A dish "signature" — the text embedded for suggestion dedup. Combines the
 * identifying English name, the tags (cuisine/course/component), and the
 * ingredient set so two suggestions for the SAME dish under different names
 * ("Som Tam" vs "Green Papaya Salad") cluster together, while genuine variations
 * (Thai vs Lao papaya salad) stay apart on their differing ingredients.
 *
 * Shared so the app (store + query side) and the re-signature backfill build it
 * identically — a stored embedding and a query embedding for the same dish must
 * match, or dedup silently breaks.
 */
export function buildSuggestionSignature(input: {
    name: string;
    nameEn?: string | null;
    tags: string[];
    ingredients: string[];
}): string {
    const englishName = (input.nameEn?.trim() || input.name)
        .toLowerCase()
        .trim();
    const tags = [...input.tags]
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean)
        .sort();
    const ingredients = [...input.ingredients]
        .map((i) => i.toLowerCase().trim())
        .filter(Boolean)
        .sort();

    return [englishName, tags.join(", "), ingredients.join(", ")].join(" | ");
}
