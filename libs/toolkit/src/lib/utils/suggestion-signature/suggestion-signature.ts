/**
 * A dish "signature" — the text embedded for suggestion dedup. Combines the
 * canonical name, the tags (cuisine/course/component), and the ingredient set so
 * two suggestions for the SAME dish under different names ("Som Tam" vs "Green
 * Papaya Salad") cluster together, while genuine variations (Thai vs Lao papaya
 * salad) stay apart on their differing ingredients.
 *
 * Keys on `name` and NOT on `name_en`. It used to prefer `name_en` back when that
 * column was defined as "the English translation" and `name` as "the source
 * language". Those meanings were swapped: `name` IS now the canonical, recognised
 * name and `name_en` is merely the alternate spelling — which for a dish like
 * Butter Chicken holds "Murgh Makhani", so preferring it would embed the native
 * spelling and invert the point of the signature.
 *
 * Shared so the app (store + query side) and the re-signature backfill build it
 * identically — a stored embedding and a query embedding for the same dish must
 * match, or dedup silently breaks.
 */
export function buildSuggestionSignature(input: {
    name: string;
    tags: string[];
    ingredients: string[];
}): string {
    const name = input.name.toLowerCase().trim();
    const tags = [...input.tags]
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean)
        .sort();
    const ingredients = [...input.ingredients]
        .map((i) => i.toLowerCase().trim())
        .filter(Boolean)
        .sort();

    return [name, tags.join(", "), ingredients.join(", ")].join(" | ");
}
