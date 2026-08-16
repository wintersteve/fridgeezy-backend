/**
 * Derive a short, human-readable label for a variant from the raw instruction,
 * e.g. "make it vegetarian" -> "Vegetarian". Best-effort only — the user can
 * rename it when saving.
 *
 * Shared rather than local to `modify-recipe` because the taste profile counts
 * the SAME string: a signal is only a preference once it repeats, and it can
 * only repeat if "make it vegetarian" and "Make this vegetarian" normalise to
 * one value. Two copies of this stripping rule would drift, and the symptom
 * would be silent — signals splitting across near-identical rows, none of them
 * ever reaching `TASTE_SIGNAL_MIN_OCCURRENCES`, and the feature simply never
 * doing anything.
 */
export const deriveVariantLabel = (instruction: string): string => {
    const cleaned = instruction
        .trim()
        .replace(
            /^(please\s+)?(can you\s+)?(make (it|this)|turn (it|this) into|convert (it|this) to)\s+/i,
            ""
        )
        .trim();
    const label = cleaned.length > 0 ? cleaned : instruction.trim();
    const capped = label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label;

    return capped.charAt(0).toUpperCase() + capped.slice(1);
};
