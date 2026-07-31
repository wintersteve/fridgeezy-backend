export interface SplitIngredientName {
    /** Ingredient name with any parenthetical qualifiers removed. */
    name: string;
    /**
     * Text extracted from the parenthetical(s), appended after any existing
     * comment. `undefined` when there is nothing to note.
     */
    note?: string;
}

/**
 * Ingredient names must never carry parenthetical qualifiers. The LLM sometimes
 * emits e.g. "chicken breast (boneless)" where "boneless" belongs in the
 * comment field — the parenthetical dirties the catalog name and breaks
 * exact-name matching against known ingredients.
 *
 * Strip every `(...)` group from the name and fold its contents into `note`,
 * appended after any existing comment. If the name is *entirely* parenthetical
 * (e.g. "(scallions)") the first captured group becomes the name so nothing is
 * left empty.
 */
export function splitIngredientName(
    rawName: string,
    existingComment?: string
): SplitIngredientName {
    const notes: string[] = [];
    let name = rawName
        .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
            const trimmed = inner.trim();
            if (trimmed) notes.push(trimmed);
            return " ";
        })
        .replace(/\s+/g, " ")
        .trim();

    if (!name && notes.length > 0) {
        name = notes.shift() ?? rawName.trim();
    }

    const parts = [existingComment?.trim(), ...notes].filter(
        (part): part is string => !!part
    );
    const note = parts.length > 0 ? parts.join(", ") : undefined;

    return { name, note };
}
