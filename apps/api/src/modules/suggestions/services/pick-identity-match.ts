import { suggestionCanonicalId } from "@fridgeezy/toolkit";

import { relateCuisines, type CuisineRelator } from "./cuisine-identity";

/**
 * Do these two dish names collapse to the same identity key?
 *
 * The question an adjudication call site asks to decide its failure direction:
 * a "not same" answer on a same-name pair now WRITES a second row, where the old
 * unique constraint made that impossible. See `AdjudicateOptions.onError`.
 */
export function sharesCanonicalName(a: string, b: string): boolean {
    const left = suggestionCanonicalId(a);
    return left !== null && left === suggestionCanonicalId(b);
}

export interface IdentityCandidate<T> {
    row: T;
    identityCuisine: string | null;
    /** For the log line only. */
    label: string;
}

/**
 * Given every row sharing this dish's canonical name, which one IS this dish?
 *
 * Before 2026-08-12 the question could not arise: `recipe_suggestions.canonical_id`
 * was unique outright, so an exact name lookup returned 0 or 1 rows and a hit was
 * treated as proof. That made the exact-name path the ONE layer in the pipeline
 * that never adjudicated anything — and it silently replaced Kazakh Manti with
 * Turkish Manti, with no LLM, no embedding and nothing logged.
 *
 * Now the lookup returns 0..N and the cuisine picks among them:
 *
 * - **same / unknown / ancestor** -> this is the dish. Free, no LLM. Unknown
 *   merges deliberately, so a row with no cuisine behaves as it always has.
 * - **disjoint** -> do NOT answer. Return null and let the caller fall through
 *   to the signature layer.
 *
 * ## Why disjoint falls through instead of adjudicating here
 *
 * Because the signature already separates these, measured before any of this was
 * built (`calibrate-thresholds`, 2026-08-12):
 *
 *     homographs      0.741 - 0.846    all below HIGH (0.92) — never auto-merged
 *     cuisine drift   0.906 - 0.946    all above LOW (0.75)  — never auto-split
 *
 * The two distributions do not overlap. So a disjoint pair reaches the existing
 * gray-band adjudicator on its own, which then kept 5/5 homographs apart and
 * merged 4/4 drift pairs, deterministically. Adding a second adjudication call
 * HERE would pay twice for one decision and put the answer in two places.
 *
 * The cost of falling through is that the dish pays the authenticity review that
 * step 0 exists to skip — but only when a name hit is genuinely ambiguous, which
 * is rare, and paying it is the entire point: it is what buys the canonical name
 * every layer below keys on.
 */
export async function pickIdentityMatch<T>(
    incoming: { name: string; cuisine: string | null },
    candidates: Array<IdentityCandidate<T>>,
    relate: CuisineRelator = relateCuisines
): Promise<T | null> {
    if (candidates.length === 0) return null;

    const disjoint: string[] = [];

    for (const candidate of candidates) {
        const relation = await relate(incoming.cuisine, candidate.identityCuisine);

        if (relation === "disjoint") {
            disjoint.push(`${candidate.label} [${candidate.identityCuisine}]`);
            continue;
        }

        if (relation === "ancestor") {
            // Worth its own line: this is the drift the tree resolves for free,
            // and the rate is the signal for whether an alias is missing.
            console.log(
                `[Identity] "${incoming.name}" [${incoming.cuisine}] matches ${candidate.label} [${candidate.identityCuisine}] — same branch`
            );
        }

        return candidate.row;
    }

    console.log(
        `[Identity] "${incoming.name}" [${incoming.cuisine ?? "none"}] shares a name with ${disjoint.length} row(s) in another cuisine (${disjoint.join(", ")}) — deferring to the signature layer`
    );

    return null;
}
