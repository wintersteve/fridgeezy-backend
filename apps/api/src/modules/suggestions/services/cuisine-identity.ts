import { supabaseAdmin } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

/**
 * How two identity cuisines relate, for deciding whether two dishes sharing a
 * canonical name are the same dish.
 *
 * Four outcomes rather than equal/not-equal, because string inequality would
 * repeat the mistake this replaces one level up — treating a labelling
 * difference as a difference in the dish.
 */
export type CuisineRelation =
    /** The same cuisine. The overwhelmingly common case. */
    | "same"
    /**
     * At least one side has no identity cuisine. Treated as a WILDCARD that
     * merges, not as a distinct identity — which is exactly the behaviour before
     * this column existed, and what keeps rows the backfill could not fill
     * (no cuisine tag at all) behaving as they always have.
     */
    | "unknown"
    /**
     * One is a descendant of the other: `levantine` under `middle eastern`.
     * Merges, free, with no LLM.
     *
     * This is the drift that actually occurs. Measured on the live catalogue
     * 2026-08-12: `Shakshuka [middle eastern]` sits beside `Shakshuka with
     * Merguez [north african]`, and Shawarma is split across `levantine` and
     * `middle eastern`. The sibling drift the generator prompt implies
     * (`sichuan` vs `chinese`) has never happened — 24 dishes carry `chinese`
     * and none carries any Chinese regional cuisine.
     */
    | "ancestor"
    /** Different branches. The contested case — see `pickIdentityMatch`. */
    | "disjoint";

export type CuisineRelator = (
    a: string | null,
    b: string | null
) => CuisineRelation | Promise<CuisineRelation>;

interface CuisineNode {
    canonicalId: string;
    parentCanonicalId: string | null;
    /** Distance from a continental root; 99 for anything not reachable from one. */
    depth: number;
}

interface CuisineTree {
    nodes: Map<string, CuisineNode>;
    /** alias canonical_id -> the canonical_id of the cuisine it names. */
    aliases: Map<string, string>;
}

/**
 * Same TTL as `listCatalogDishes`, for the same reason: this changes only when
 * `matchTags` invents a cuisine, and re-reading 172 + 47 rows on every dish in
 * every batch would be pure waste.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Nothing enforces acyclicity on `tags.parent_id` and `matchTags` writes into
 * the tree at runtime, so every walk over it is bounded. The seeded tree is
 * three deep.
 */
const MAX_DEPTH = 10;

const ROOT_CANONICAL_IDS = ["asian", "european", "african", "americas", "oceania"];

let cache: { tree: CuisineTree; at: number } | null = null;

async function loadCuisineTree(): Promise<CuisineTree> {
    const [tagsResult, aliasResult] = await Promise.all([
        supabaseAdmin
            .from("tags")
            .select("id, canonical_id, parent_id")
            .eq("type", "cuisine"),
        supabaseAdmin
            .from("tag_aliases")
            .select("canonical_id, tag_id")
            .eq("type", "cuisine"),
    ]);

    const nodes = new Map<string, CuisineNode>();
    const aliases = new Map<string, string>();

    if (tagsResult.error) {
        // An empty tree degrades to "everything is unknown", which merges — the
        // pre-column behaviour. Never throw: this sits on the path of every
        // suggestion, and a flaky read must not drop dishes.
        console.error(
            "[Cuisine] Could not read the cuisine tree; treating every cuisine as unknown:",
            tagsResult.error.message
        );
        return { nodes, aliases };
    }

    const rows = tagsResult.data ?? [];
    const canonicalById = new Map(rows.map((row) => [row.id, row.canonical_id]));
    const parentOf = new Map(
        rows.map((row) => [
            row.canonical_id,
            row.parent_id ? (canonicalById.get(row.parent_id) ?? null) : null,
        ])
    );

    for (const row of rows) {
        nodes.set(row.canonical_id, {
            canonicalId: row.canonical_id,
            parentCanonicalId: parentOf.get(row.canonical_id) ?? null,
            depth: depthOf(row.canonical_id, parentOf),
        });
    }

    if (aliasResult.error) {
        console.error(
            "[Cuisine] Could not read cuisine aliases; spellings will not resolve:",
            aliasResult.error.message
        );
    } else {
        for (const row of aliasResult.data ?? []) {
            const target = canonicalById.get(row.tag_id);
            if (target) aliases.set(row.canonical_id, target);
        }
    }

    return { nodes, aliases };
}

/**
 * Distance from a continental ROOT, not from wherever the chain happens to end.
 *
 * Anchored on the five known roots rather than on "has no parent", because
 * `matchTags` creates cuisines at runtime and a failed parent lookup leaves one
 * orphaned at the top — two already exist (`jewish`, `lithuanian`). Treating
 * those as roots would rate them the LEAST specific tag on a dish when they are
 * in fact the most, so an unreachable node is scored as maximally specific. The
 * same rule the backfill in `20260812000003` uses.
 */
function depthOf(
    canonicalId: string,
    parentOf: Map<string, string | null>
): number {
    let current: string | null = canonicalId;
    const seen = new Set<string>();

    for (let steps = 0; current && steps <= MAX_DEPTH; steps++) {
        if (ROOT_CANONICAL_IDS.includes(current)) return steps;
        if (seen.has(current)) break;
        seen.add(current);
        current = parentOf.get(current) ?? null;
    }

    return 99;
}

async function getTree(): Promise<CuisineTree> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.tree;
    }

    const tree = await loadCuisineTree();
    cache = { tree, at: Date.now() };
    return tree;
}

function isAncestor(
    tree: CuisineTree,
    ancestor: string,
    descendant: string
): boolean {
    let current = tree.nodes.get(descendant)?.parentCanonicalId ?? null;

    for (let steps = 0; current && steps < MAX_DEPTH; steps++) {
        if (current === ancestor) return true;
        current = tree.nodes.get(current)?.parentCanonicalId ?? null;
    }

    return false;
}

/** {@link CuisineRelation} for two identity cuisines. */
export async function relateCuisines(
    a: string | null,
    b: string | null
): Promise<CuisineRelation> {
    if (!a || !b) return "unknown";
    if (a === b) return "same";

    const tree = await getTree();

    // A cuisine that is not in the tree at all can only be compared by equality,
    // which already failed. Do not guess.
    if (!tree.nodes.has(a) || !tree.nodes.has(b)) return "disjoint";

    return isAncestor(tree, a, b) || isAncestor(tree, b, a)
        ? "ancestor"
        : "disjoint";
}

/**
 * The ONE cuisine that is part of this dish's identity, from the tags the
 * generator produced.
 *
 * Derived from the tags rather than asked of the authenticity gate, and the
 * reason is sequencing: the gate runs at step 1 of `persistOrReuseSuggestion`,
 * while `findKnownDish` runs at step 0 and is precisely where the tiebreak is
 * most valuable. A gate-supplied cuisine would arrive too late to be used there.
 *
 * Free, too. The tree and its aliases are already cached for `relateCuisines`,
 * so this is pure in-memory work — no query, no embedding, no LLM.
 *
 * Picks the DEEPEST cuisine when a dish carries more than one (a genuine fusion
 * dish may carry two: Tex-Mex is american + mexican), ties broken by canonical
 * id. Same rule as the backfill, so a row written today and a row backfilled
 * yesterday agree.
 */
export async function resolveIdentityCuisine(
    tags: string[],
    requestCuisine?: string | null
): Promise<string | null> {
    const tree = await getTree();

    const resolve = (value: string | null | undefined): string | null => {
        const canonical = canonicalizeName(value);
        if (!canonical) return null;
        if (tree.nodes.has(canonical)) return canonical;
        return tree.aliases.get(canonical) ?? null;
    };

    const candidates = tags
        .map(resolve)
        .filter((id): id is string => id !== null);

    // The request's cuisine filter is a fallback, not a preference: the dish's
    // own tags say what it IS, while the filter only says what was asked for.
    if (candidates.length === 0) {
        return resolve(requestCuisine);
    }

    return candidates.sort((x, y) => {
        const depthDiff =
            (tree.nodes.get(y)?.depth ?? 99) - (tree.nodes.get(x)?.depth ?? 99);
        return depthDiff !== 0 ? depthDiff : x.localeCompare(y);
    })[0];
}
