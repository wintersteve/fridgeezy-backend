import { generateCompletion } from "@fridgeezy/llm";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";

import { DISH_NAME_ALT_RULE, DISH_NAME_RULE } from "./naming-rules";
import { describeSuggestion } from "./suggestion-signature";

export type AuthenticityStatus =
    | "canonical"
    | "regional_variant"
    | "modern_fusion"
    | "invention"
    | "unknown";

export interface AuthenticityVerdict {
    status: AuthenticityStatus;
    confidence: number;
    /**
     * What the dish should be CALLED, by the same rule the generator was given.
     * Usually the proposed name echoed back; a correction when the generator
     * reached for a native name English sources don't use.
     */
    name?: string;
    nameAlt?: string | null;
}

/** The verdict as callers act on it: does this dish go in, and under what name? */
export interface SuggestionReview {
    authentic: boolean;
    /** Set only when the name should CHANGE — absent means keep what was proposed. */
    name?: string;
    nameAlt?: string | null;
}

/** Minimum confidence for an attested verdict to be trusted. */
const CONFIDENCE_FLOOR = 0.6;
/** Statuses allowed into the discovery catalog. */
const ATTESTED: AuthenticityStatus[] = ["canonical", "regional_variant"];

const STATUSES: AuthenticityStatus[] = [
    "canonical",
    "regional_variant",
    "modern_fusion",
    "invention",
    "unknown",
];

/**
 * Naming is folded into the authenticity check rather than given its own call.
 *
 * The two judgements want exactly the same evidence — is this a real dish, and
 * what do people actually call it — and this call already runs once per new
 * dish, in parallel with dedup, so the naming pass is free. A separate call
 * before the provisional card would have added its full latency to every card.
 *
 * The generator's own naming rule was not enough on its own: it already asked
 * for "the name an English-speaking home cook would most commonly recognise" and
 * still produced *Pain Aux Bananes* for banana bread. This is a second, single-
 * purpose look at one dish, with the rule quoted verbatim so the two can't drift.
 */
const SYSTEM_PROMPT = `You verify that a proposed recipe is a REAL, attested dish before it enters a discovery catalog, and you decide what that dish should be CALLED.

## 1. Classify the dish into one status
- "canonical": a well-documented dish with an established identity — traditional (Murgh Makhani, Spaghetti alla Carbonara) OR a modern dish that is now widely recognised in its own right (California Roll, Buffalo Wings, Nachos).
- "regional_variant": an attested regional or traditional variation of a real dish (e.g. Lao-style green papaya salad).
- "modern_fusion": a plausible modern/fusion creation that is NOT (yet) an established, recognised dish.
- "invention": an arbitrary combination unlikely to be an established dish (e.g. "Carbonara with Asparagus"), or a hallucinated / non-existent dish.
- "unknown": you cannot tell.

Only "canonical" and "regional_variant" belong in a discovery catalog. Weigh the ingredients and cuisine, not just the name.

## 2. Name the dish
Apply this rule to the dish you just classified, and return the result whether or not it differs from the proposed name:

${DISH_NAME_RULE}

${DISH_NAME_ALT_RULE}

Echo the proposed name back unchanged unless it clearly breaks the rule. Renaming a dish that was already right is worse than leaving it alone.

Corrections only ever run in ONE direction: toward the name an English speaker understands. If the proposed name is already plain English, keep it — never swap it back to the native name because the native one is more "authentic". Authenticity is what the status field is for; this field is about being understood.

Respond with a single JSON object and nothing else:
{"status":"canonical"|"regional_variant"|"modern_fusion"|"invention"|"unknown","confidence":0.0-1.0,"name":"...","name_alt":"..."|null}.`;

/**
 * Raw classification (status + confidence + the name it should carry). Throws on
 * API error — the gate below handles that as fail-open. Exposed so the
 * calibration eval can inspect the distribution.
 */
export async function classifySuggestionAuthenticity(
    suggestion: GenerateSuggestionResponseDto
): Promise<AuthenticityVerdict> {
    const { text: content } = await generateCompletion({
        // gpt-4o, not the -mini this used while it only classified authenticity.
        // Naming is a judgement at the margin — is "Rendang" met in English on
        // its own? — and mini was inconsistent on exactly that tail: it renamed
        // "Klepon" on one run and kept it on the next, and once corrected
        // "Savoury Cabbage Pancake" BACK to "Okonomiyaki". One call per NEW dish
        // (dedup returns before this for anything already in the catalog), so
        // the cost is bounded by how many genuinely new dishes are generated.
        model: { openai: "gpt-4o" },
        system: SYSTEM_PROMPT,
        user: describeSuggestion(
            suggestion.name,
            suggestion.name_alt,
            suggestion.tags,
            suggestion.ingredients
        ),
        json: true,
        // Was 20, when the verdict was two fields. A truncated response is
        // unparseable JSON, which fails open and silently stops correcting names.
        maxTokens: { openai: 80 },
    });

    if (!content) return { status: "unknown", confidence: 0 };

    const parsed = JSON.parse(content) as {
        status?: string;
        confidence?: number;
        name?: string;
        name_alt?: string | null;
    };
    const status = STATUSES.includes(parsed.status as AuthenticityStatus)
        ? (parsed.status as AuthenticityStatus)
        : "unknown";

    return {
        status,
        confidence: parsed.confidence ?? 0,
        name: typeof parsed.name === "string" ? parsed.name.trim() : undefined,
        nameAlt: typeof parsed.name_alt === "string" ? parsed.name_alt.trim() : null,
    };
}

/**
 * Authenticity gate + canonical name: is this an attested dish that belongs in
 * discovery, and is it named the way English-language sources name it? A second
 * pass over the generator's own "AUTHENTICITY IS PARAMOUNT" prompt — catches
 * inventions/hallucinations the generator lets through. Only runs for genuinely
 * new dishes (dedup handles the already-vetted existing ones). Fails OPEN
 * (authentic, name unchanged) on any error so an LLM hiccup never drops valid
 * dishes.
 *
 * A `name` comes back only when it should actually CHANGE: an unchanged name is
 * reported as absent so callers can skip the rename path (an extra lookup and a
 * re-embed) on the common case.
 */
export async function verifySuggestionAuthenticity(
    suggestion: GenerateSuggestionResponseDto
): Promise<SuggestionReview> {
    try {
        const verdict = await classifySuggestionAuthenticity(suggestion);
        const authentic =
            ATTESTED.includes(verdict.status) &&
            verdict.confidence >= CONFIDENCE_FLOOR;

        if (!authentic || !verdict.name || !isRename(suggestion.name, verdict.name)) {
            return { authentic };
        }

        console.log(
            `[Suggestions] Renaming "${suggestion.name}" -> "${verdict.name}"`
        );

        return {
            authentic,
            name: verdict.name,
            // Keep the name it arrived under as the alternate, unless the
            // reviewer named a better one — a dish renamed away from its native
            // spelling should still be findable by it.
            nameAlt: verdict.nameAlt || suggestion.name,
        };
    } catch (error) {
        console.error(
            `[Suggestions] Authenticity check failed for "${suggestion.name}" — allowing:`,
            error
        );
        return { authentic: true };
    }
}

/**
 * Whether a proposed name is a real change rather than a reformatting. Case and
 * surrounding whitespace differences are not worth an extra name lookup and a
 * re-embed.
 */
function isRename(current: string, proposed: string): boolean {
    return current.trim().toLowerCase() !== proposed.trim().toLowerCase();
}
