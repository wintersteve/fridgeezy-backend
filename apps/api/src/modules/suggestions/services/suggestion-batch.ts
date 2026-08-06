import { canonicalizeName } from "@fridgeezy/toolkit";

import { adjudicateSameDish } from "./adjudicate-suggestion";
import type { SuggestionOutcome } from "./suggestion-outcome";
import {
    SIGNATURE_HIGH_THRESHOLD,
    SIGNATURE_LOW_THRESHOLD,
} from "./suggestion-signature";

/**
 * How a dish identifies itself to its siblings, once its name has been
 * canonicalised and its signature embedded.
 */
export interface SuggestionIdentity {
    /** Canonical name key — the same rule the DB's `canonical_id` uses. */
    key: string | null;
    /** Descriptor for the LLM adjudicator, when the cosine lands in the gray band. */
    describe: string;
    name: string;
    embedding: number[];
}

/**
 * One dish's place in the batch. Opened synchronously on arrival so the arrival
 * ORDER is fixed before any async work begins — see {@link createSuggestionBatch}.
 */
export interface SuggestionSlot {
    /** Publish this dish's identity so LATER siblings can compare against it. */
    identify: (identity: SuggestionIdentity) => void;
    /** This dish is going nowhere (unauthentic, unparseable) — never match it. */
    abandon: () => void;
    /** Publish the final outcome, which a later duplicate sibling adopts. */
    settle: (outcome: SuggestionOutcome) => void;
    /**
     * The outcome of the first EARLIER sibling that is the same dish, or null.
     * Awaits those siblings' identities, so it must be called after
     * {@link identify}.
     */
    findEarlierDuplicate: (
        identity: SuggestionIdentity
    ) => Promise<SuggestionOutcome | null>;
}

export interface SuggestionBatch {
    open: () => SuggestionSlot;
}

/**
 * Decides the gray band. Injectable for one reason: the offline check
 * (`evals/batch-dedup.check.ts`) has to drive the ordering logic deterministically,
 * and the real adjudicator is a network call.
 */
export type SameDishAdjudicator = (
    dishA: string,
    dishB: string
) => Promise<boolean>;

interface Entry {
    identity: Promise<SuggestionIdentity | null>;
    outcome: Promise<SuggestionOutcome | null>;
    resolveIdentity: (identity: SuggestionIdentity | null) => void;
    resolveOutcome: (outcome: SuggestionOutcome | null) => void;
}

/**
 * Intra-request dedup for one batch of suggestions.
 *
 * The batch generator starts `persistOrReuseSuggestion` for every JSONL line
 * CONCURRENTLY, which is what makes the first card arrive seconds before the
 * last. The cost was that every dedup layer queried a database that did not yet
 * contain the dish's own siblings, so two lines of one batch could never see each
 * other — measured in the dev catalog as `Haemul Pajeon` / `Pajeon` inserted
 * 1.8s apart and `Shakshuka with Merguez` / `Shakshuka` 2.4s apart, each pair a
 * single dish stored twice.
 *
 * This closes that hole WITHOUT serialising the batch: siblings compare in
 * memory, against vectors that have already been computed for the database
 * search anyway. The common case — four genuinely different dishes — costs four
 * cosine products and no I/O at all.
 *
 * **Deadlock is prevented by arrival order, not by locking.** {@link open} is
 * synchronous and hands out a monotonic index; a slot only ever waits on slots
 * with a LOWER index. That makes the "waits for" relation a strict partial order,
 * so a cycle cannot form however the four requests interleave. Every rule here
 * follows from that: identity is published before the database work rather than
 * after, so an earlier sibling never blocks a later one for longer than its own
 * embedding takes.
 */
export function createSuggestionBatch(
    adjudicate: SameDishAdjudicator = adjudicateSameDish
): SuggestionBatch {
    const entries: Entry[] = [];

    return {
        open() {
            let resolveIdentity!: (identity: SuggestionIdentity | null) => void;
            let resolveOutcome!: (outcome: SuggestionOutcome | null) => void;

            const entry: Entry = {
                identity: new Promise((resolve) => {
                    resolveIdentity = resolve;
                }),
                outcome: new Promise((resolve) => {
                    resolveOutcome = resolve;
                }),
                resolveIdentity: (identity) => resolveIdentity(identity),
                resolveOutcome: (outcome) => resolveOutcome(outcome),
            };

            // Index is taken NOW, synchronously, which is the whole ordering
            // guarantee — nothing below awaits before the push.
            const index = entries.push(entry) - 1;

            return {
                identify: (identity) => entry.resolveIdentity(identity),
                abandon: () => {
                    entry.resolveIdentity(null);
                    entry.resolveOutcome(null);
                },
                settle: (outcome) => {
                    // A dish that returns before publishing an identity still
                    // has to release anyone already waiting on it.
                    entry.resolveIdentity(null);
                    entry.resolveOutcome(outcome);
                },
                findEarlierDuplicate: (identity) =>
                    findEarlierDuplicate(
                        entries.slice(0, index),
                        identity,
                        adjudicate
                    ),
            };
        },
    };
}

/**
 * Walk the earlier siblings in arrival order and return the outcome of the first
 * one that is the same dish.
 *
 * Three tests, cheapest first:
 *
 * 1. **Canonical name equality** — free, and the case that matters most now that
 *    naming is canonicalised BEFORE dedup: "Cucumber Sunomono" and "Sunomono"
 *    both arrive here as the same key, so the pair collapses with no vector
 *    maths and no LLM call.
 * 2. **Signature cosine at/above the auto-merge threshold** — free, ~1536
 *    multiply-adds.
 * 3. **LLM adjudication through the calibrated gray band** — the only test that
 *    costs anything, and it is the same `adjudicateSameDish` the database layers
 *    already pay for, on the same thresholds. Reached only by a pair that is
 *    genuinely ambiguous.
 */
async function findEarlierDuplicate(
    earlier: Entry[],
    identity: SuggestionIdentity,
    adjudicate: SameDishAdjudicator
): Promise<SuggestionOutcome | null> {
    for (const entry of earlier) {
        const other = await entry.identity;
        if (!other) continue;

        const sameKey =
            identity.key !== null && other.key !== null && identity.key === other.key;

        let isSameDish = sameKey;

        if (!isSameDish) {
            const score = cosineSimilarity(identity.embedding, other.embedding);

            if (score < SIGNATURE_LOW_THRESHOLD) continue;

            isSameDish =
                score >= SIGNATURE_HIGH_THRESHOLD ||
                (await adjudicate(identity.describe, other.describe));

            if (isSameDish) {
                console.log(
                    `[Suggestions] Batch duplicate: "${identity.name}" ≡ "${other.name}" (score ${score.toFixed(3)}${score >= SIGNATURE_HIGH_THRESHOLD ? "" : ", adjudicated"})`
                );
            }
        } else {
            console.log(
                `[Suggestions] Batch duplicate: "${identity.name}" ≡ "${other.name}" (same canonical name)`
            );
        }

        if (!isSameDish) continue;

        const outcome = await entry.outcome;

        // Only adopt an outcome that actually resolves the dish. A sibling that
        // failed to persist tells us nothing about whether OUR insert would, so
        // falling through to do the work ourselves is strictly better than
        // inheriting its failure.
        if (
            outcome &&
            (outcome.kind === "suggestion" || outcome.kind === "existing_recipe")
        ) {
            return outcome;
        }
    }

    return null;
}

/** The canonical-name key two siblings are compared on, by the DB's own rule. */
export function identityKey(name: string): string | null {
    return canonicalizeName(name);
}

/**
 * Cosine similarity between two embeddings.
 *
 * Computed in full rather than as a bare dot product: OpenAI returns unit
 * vectors today, so the norms are 1 and this is the same number — but a stored
 * vector that ever stops being normalised would silently shift every score
 * against the calibrated thresholds instead of failing.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    return denominator === 0 ? 0 : dot / denominator;
}
