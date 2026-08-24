import { supabaseAdmin } from "@fridgeezy/supabase";
import {
    ingredientCanonicalId,
    isAdjudicableCandidate,
} from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Proves the ingredient resolver reaches the right row, by replaying every name
 * in the catalogue through it.
 *
 * Two defects let `Scallion`, `Green Onion` and `Spring Onion` become three
 * rows, and they failed independently, which is why both halves are asserted
 * here:
 *
 *  1. The alias lookup compared the raw name to the stored `alias` literally.
 *     PostgREST `.in()` is case-sensitive and 236 of 238 aliases are stored
 *     lowercase, so Title-Case model output never matched — while the table
 *     held `green onion -> Scallion` the whole time.
 *  2. Vector retrieval returned ONE candidate. Name embeddings are lexical, so
 *     a shared head noun dominates the score and rank 1 is systematically a
 *     SIBLING; the synonym sits further down and was never offered. The
 *     adjudicator answered correctly every time about the wrong ingredient.
 *
 * The regression that matters is the opposite one, and it is the reason this
 * sweeps the whole catalogue rather than the handful of cases we discussed.
 * Widening retrieval offers MORE siblings, so if the structural interlock is
 * wrong or missing, the wider net starts merging `Rice Flour` into `Flour` —
 * silent, and it corrupts recipes rather than just cluttering a list.
 *
 * ## How a name is tested
 *
 * Each existing ingredient is MASKED — its own row hidden — and its name is
 * re-resolved against everything else. That reconstructs the moment the name
 * first arrived, which is the only moment the resolver ever gets to decide. Two
 * outcomes are correct and one is not:
 *
 *  - resolves to NOTHING            -> it would be created. Correct: it is a
 *                                      distinct ingredient and it exists.
 *  - resolves to a KNOWN synonym    -> correct, and the duplicate we want gone.
 *  - resolves to anything ELSE      -> REGRESSION. A distinct ingredient would
 *                                      have been swallowed by another row.
 *
 * "Known synonym" is read from `ingredient_aliases`, which is the catalogue's
 * own record of what it considers the same thing.
 *
 * ## What this does NOT do
 *
 * It writes nothing, and it does not require the migration to be applied — the
 * alias canonicalisation and the self-alias drop are simulated in memory, so
 * this can be run read-only against a database that has not migrated yet, which
 * is how it was used to justify the migration in the first place.
 *
 * By default the LLM layer is skipped and only the deterministic layers run
 * (canonical, alias, structural), which is free and reproducible. Pass
 * `IDENTITY_LLM=true` to adjudicate the shortlists for real — about 1,000
 * gpt-4o-mini calls, a few cents.
 */

const GRAY_BAND_THRESHOLD = 0.6;
const CANDIDATE_LIMIT = 10;
const SHORTLIST_LIMIT = 5;

interface Row {
    id: string;
    name: string;
    canonical_id: string;
}

interface Candidate {
    id: string;
    name: string;
    similarity: number;
}

/**
 * The pairs from INGREDIENT_IDENTITY.md, asserted by name.
 *
 * `knownDefect` marks a case whose expected value records a PRE-EXISTING data
 * error rather than a property of the resolver. Those are reported and do not
 * fail the run — the resolver is behaving correctly given bad input, and fixing
 * the input is a cleanup step deliberately deferred.
 */
const NAMED_CASES: Array<{
    name: string;
    expect: string | null;
    note: string;
    knownDefect?: string;
}> = [
    { name: "Green Onion", expect: "Scallion", note: "alias, DIFF_HEAD" },
    { name: "Spring Onion", expect: "Scallion", note: "alias, DIFF_HEAD" },
    {
        name: "Soya Sauce",
        expect: null,
        note: "conservative miss — creates rather than merging",
        knownDefect:
            "'soya' vs 'soy' is a spelling variant the head-noun rule reads as a " +
            "sibling, so the shortlist is empty and it creates. The SAFE direction " +
            "(it notably does NOT reach Sweet Soy Sauce, which the old rank-1 " +
            "retrieval offered at 0.871). Fix is data, not rule: add the alias " +
            "'soya sauce' -> Soy Sauce. Loosening the structural rule to catch it " +
            "by edit distance would also start merging 'lima bean' into 'lime bean'.",
    },
    { name: "All Purpose Flour", expect: "Flour", note: "alias, BARE_VS_MOD" },
    { name: "Rice Flour", expect: null, note: "MUST stay distinct from Flour" },
    { name: "Flour", expect: null, note: "the base; must not be swallowed" },
    { name: "Active Dry Yeast", expect: "Yeast", note: "alias" },
    { name: "Beetroot", expect: "Beets", note: "alias" },
    { name: "Chicken Egg", expect: "Egg", note: "alias, default form" },
    { name: "Duck Egg", expect: null, note: "MUST stay distinct from Egg" },
    { name: "White Pepper", expect: null, note: "MUST stay distinct from Black Pepper" },
    {
        name: "Red Bell Pepper",
        expect: "Green Bell Pepper",
        note: "resolves via a WRONG alias, under masking only",
        knownDefect:
            "'red bell pepper' -> Green Bell Pepper is a bad alias, learned at " +
            "runtime on 2026-07-29 by the old single-candidate adjudicator. It is " +
            "unreachable in production: a Red Bell Pepper row exists and step 1 " +
            "resolves canonical before aliases. This sweep masks the row, which is " +
            "what exposes it. Fix is to delete the alias during cleanup.",
    },
];

async function main() {
    const useLlm = process.env.IDENTITY_LLM === "true";
    console.log(
        `\n[identity] deterministic layers${useLlm ? " + LLM adjudication" : " only (set IDENTITY_LLM=true to include the LLM)"}\n`
    );

    // ---- load the catalogue ------------------------------------------------
    // Paginated: PostgREST caps a response at 1000 rows, and silently. An
    // unpaginated read dropped 67 ingredients on the first run of this script
    // and reported two false failures, because an alias whose TARGET fell off
    // the end looks exactly like an alias that does not exist.
    const rows: Row[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, name, canonical_id")
            .order("id")
            .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`load ingredients: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...(data as Row[]));
        if (data.length < pageSize) break;
    }

    const aliasRows: Array<{ alias: string; ingredient_id: string }> = [];
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin
            .from("ingredient_aliases")
            .select("alias, ingredient_id")
            .order("id")
            .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`load aliases: ${error.message}`);
        if (!data || data.length === 0) break;
        aliasRows.push(...data);
        if (data.length < pageSize) break;
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const byCanonical = new Map(rows.map((row) => [row.canonical_id, row]));

    // Alias table AS THE MIGRATION LEAVES IT: keyed on the canonical form, with
    // self-aliases (canonical == its own target's canonical) dropped. Those are
    // inert — canonical resolution runs first — and they are the entire source
    // of canonical collision, so dropping them is what makes the key unique.
    const aliasTarget = new Map<string, string>();
    let selfAliases = 0;
    let siblingAliases = 0;
    const withheldAliases: Array<{ alias: string; target: string }> = [];

    for (const row of aliasRows) {
        const canonical = ingredientCanonicalId(row.alias);
        const target = byId.get(row.ingredient_id);
        if (!target) continue;
        if (target.canonical_id === canonical) {
            selfAliases += 1;
            continue;
        }
        // Sibling-shaped aliases are HONOURED, matching `matchIngredients`.
        // They are counted and listed rather than withheld: they are mostly
        // legitimate spelling/regional variants that share a head noun
        // ("chilli powder" -> Chili Powder), and the wrong ones are unreachable
        // in production because an ingredient row of the same canonical id
        // resolves first. Reported so the ratio stays visible.
        if (!isAdjudicableCandidate(row.alias, target.name)) {
            siblingAliases += 1;
            if (byCanonical.has(canonical)) {
                withheldAliases.push({ alias: row.alias, target: target.name });
            }
        }
        if (!aliasTarget.has(canonical)) aliasTarget.set(canonical, target.id);
    }

    console.log(
        `[identity] ${rows.length} ingredients, ${aliasRows.length} aliases ` +
            `(${selfAliases} self, ${siblingAliases} sibling-shaped, ${aliasTarget.size} usable)\n`
    );

    // An alias that is sibling-shaped AND has a competing ingredient row of its
    // own canonical id is the contradiction class: the catalogue says both
    // "these are the same" and "these are two rows". Unreachable at runtime
    // (canonical resolves first) but exactly what a human should adjudicate.
    if (withheldAliases.length > 0) {
        console.log(
            `  --- ${withheldAliases.length} contradictions for human review ` +
                "(alias says same, a separate row says otherwise) ---"
        );
        for (const { alias, target } of withheldAliases) {
            console.log(`    "${alias}" -> ${target}`);
        }
        console.log();
    }

    // ---- candidate retrieval ------------------------------------------------
    const neighbours = await retrieveNeighbours(rows);

    // ---- resolve ------------------------------------------------------------
    const resolveDeterministic = (
        row: Row
    ): { target: Row | null; via: string; shortlist: Candidate[] } => {
        const canonical = row.canonical_id;

        // 1. canonical — masked, so its own row cannot answer
        const exact = byCanonical.get(canonical);
        if (exact && exact.id !== row.id) {
            return { target: exact, via: "canonical", shortlist: [] };
        }

        // 2. alias
        const aliasId = aliasTarget.get(canonical);
        if (aliasId && aliasId !== row.id) {
            return { target: byId.get(aliasId) ?? null, via: "alias", shortlist: [] };
        }

        // 3. vector + structural interlock
        const shortlist = (neighbours.get(row.id) ?? [])
            .filter((candidate) => candidate.id !== row.id)
            .filter((candidate) => isAdjudicableCandidate(row.name, candidate.name))
            .slice(0, SHORTLIST_LIMIT);

        return { target: null, via: "shortlist", shortlist };
    };

    // ---- named cases --------------------------------------------------------
    console.log("=== named cases ===\n");
    let namedFailures = 0;

    for (const testCase of NAMED_CASES) {
        const row = rows.find((r) => r.name === testCase.name);
        if (!row) {
            console.log(`  ?  ${testCase.name.padEnd(20)} not in catalogue — skipped`);
            continue;
        }

        const { target, via, shortlist } = resolveDeterministic(row);
        let landed = target?.name ?? null;
        let how = via;

        if (!target && shortlist.length > 0 && useLlm) {
            const chosen = await adjudicate(row.name, shortlist);
            if (chosen) {
                landed = chosen.name;
                how = "llm";
            }
        }

        const ok = landed === testCase.expect;
        if (!ok && !testCase.knownDefect) namedFailures += 1;

        const verdict = !ok ? "FAIL" : testCase.knownDefect ? "KNOWN" : "PASS";
        const arrow = landed ? `-> ${landed}` : "-> (create)";
        console.log(
            `  ${verdict}  ${testCase.name.padEnd(20)} ${arrow.padEnd(22)} [${how}]  ${testCase.note}`
        );
        if (!ok) {
            console.log(
                `        expected ${testCase.expect ?? "(create)"}; shortlist was [${shortlist.map((c) => c.name).join(", ") || "empty"}]`
            );
        }
        if (testCase.knownDefect) {
            console.log(`        ${testCase.knownDefect}`);
        }
    }

    // ---- exposure: old retrieval vs new, deterministically ------------------
    //
    // The decisive comparison, and it needs no LLM. A candidate that must never
    // merge (a sibling, or a strictly more specific row) is a chance to corrupt
    // the catalogue; the question is how often each retrieval strategy PUTS ONE
    // IN FRONT OF THE ADJUDICATOR. Prompt quality is a separate variable, and
    // this measurement is independent of it.
    console.log("\n=== exposure to unmergeable candidates ===\n");

    let oldExposed = 0;
    let oldOfferedNothing = 0;
    let newExposed = 0;
    let newOfferedNothing = 0;
    let newReachesSynonym = 0;
    let oldReachesSynonym = 0;

    const aliasPartnerName = (row: Row): string | null => {
        const id = aliasTarget.get(row.canonical_id);
        return id ? (byId.get(id)?.name ?? null) : null;
    };

    for (const row of rows) {
        const all = (neighbours.get(row.id) ?? []).filter((c) => c.id !== row.id);
        const partner = aliasPartnerName(row);

        // OLD: rank 1 only, no structural filter.
        const rank1 = all[0];
        if (!rank1) oldOfferedNothing += 1;
        else if (!isAdjudicableCandidate(row.name, rank1.name)) oldExposed += 1;
        if (rank1 && partner && rank1.name === partner) oldReachesSynonym += 1;

        // NEW: top 10, siblings and more-specific rows withheld.
        const shortlist = all
            .filter((c) => isAdjudicableCandidate(row.name, c.name))
            .slice(0, SHORTLIST_LIMIT);
        if (shortlist.length === 0) newOfferedNothing += 1;
        newExposed += shortlist.filter(
            (c) => !isAdjudicableCandidate(row.name, c.name)
        ).length;
        if (partner && shortlist.some((c) => c.name === partner)) {
            newReachesSynonym += 1;
        }
    }

    console.log(
        `  OLD (rank-1, no filter)  unmergeable candidate offered : ${oldExposed} names`
    );
    console.log(
        `  NEW (top-10, filtered)   unmergeable candidate offered : ${newExposed} names`
    );
    console.log(
        `\n  OLD  synonym actually reachable : ${oldReachesSynonym} names`
    );
    console.log(
        `  NEW  synonym actually reachable : ${newReachesSynonym} names`
    );
    console.log(
        `\n  OLD  nothing offered : ${oldOfferedNothing}    NEW nothing offered : ${newOfferedNothing}`
    );

    // ---- full sweep ---------------------------------------------------------
    console.log("\n=== full catalogue sweep (regression) ===\n");

    const knownSynonym = (a: Row, b: Row): boolean => {
        const viaA = aliasTarget.get(a.canonical_id);
        const viaB = aliasTarget.get(b.canonical_id);
        return viaA === b.id || viaB === a.id;
    };

    let created = 0;
    let toSynonym = 0;
    const regressions: Array<{ from: Row; to: Row; via: string }> = [];
    const llmQueue: Array<{ row: Row; shortlist: Candidate[] }> = [];

    for (const row of rows) {
        const { target, via, shortlist } = resolveDeterministic(row);

        if (target) {
            if (knownSynonym(row, target)) toSynonym += 1;
            else regressions.push({ from: row, to: target, via });
            continue;
        }

        if (shortlist.length > 0 && useLlm) {
            llmQueue.push({ row, shortlist });
        } else {
            created += 1;
        }
    }

    if (useLlm && llmQueue.length > 0) {
        console.log(`  adjudicating ${llmQueue.length} shortlists...\n`);
        const batchSize = 20;
        for (let i = 0; i < llmQueue.length; i += batchSize) {
            const batch = llmQueue.slice(i, i + batchSize);
            const results = await Promise.all(
                batch.map(async ({ row, shortlist }) => ({
                    row,
                    chosen: await adjudicate(row.name, shortlist),
                }))
            );
            for (const { row, chosen } of results) {
                if (!chosen) {
                    created += 1;
                    continue;
                }
                const target = byId.get(chosen.id);
                if (target && knownSynonym(row, target)) toSynonym += 1;
                else if (target) regressions.push({ from: row, to: target, via: "llm" });
            }
        }
    }

    console.log(`  created (correctly distinct) : ${created}`);
    console.log(`  resolved to known synonym    : ${toSynonym}`);
    console.log(`  UNEXPECTED merges            : ${regressions.length}\n`);

    if (regressions.length > 0) {
        console.log("  --- every unexpected merge, for adjudication ---");
        for (const { from, to, via } of regressions) {
            console.log(`    ${from.name}  ->  ${to.name}   [${via}]`);
        }
        console.log();
    }

    const failed = namedFailures > 0 || regressions.length > 0;
    console.log(
        failed
            ? `FAILED — ${namedFailures} named case(s), ${regressions.length} unexpected merge(s)\n`
            : "OK — every name reaches its own row or a recorded synonym\n"
    );
    process.exit(failed ? 1 : 0);
}

/**
 * Top-N nearest neighbours for every ingredient.
 *
 * Embeddings are pulled once and the cosine is computed locally rather than
 * issuing `search_ingredients` per name. Same ordering — both are exact cosine
 * over the same vectors, and at 468 embedded rows there is no approximation
 * involved either way — but it is one request instead of a thousand, and it
 * makes the sweep reproducible offline.
 */
async function retrieveNeighbours(rows: Row[]): Promise<Map<string, Candidate[]>> {
    const vectors: Array<{ row: Row; vec: Float64Array; norm: number }> = [];
    const pageSize = 500;

    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, embedding")
            .not("embedding", "is", null)
            .range(offset, offset + pageSize - 1);

        if (error) throw new Error(`load embeddings: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const entry of data as Array<{ id: string; embedding: unknown }>) {
            const row = rows.find((r) => r.id === entry.id);
            if (!row) continue;

            // pgvector arrives as a JSON string over PostgREST.
            const parsed: number[] =
                typeof entry.embedding === "string"
                    ? JSON.parse(entry.embedding)
                    : (entry.embedding as number[]);

            const vec = Float64Array.from(parsed);
            let sumSquares = 0;
            for (const value of vec) sumSquares += value * value;
            vectors.push({ row, vec, norm: Math.sqrt(sumSquares) });
        }

        if (data.length < pageSize) break;
    }

    console.log(`[identity] ${vectors.length} embedded ingredients loaded\n`);

    const out = new Map<string, Candidate[]>();

    for (const source of vectors) {
        const scored: Candidate[] = [];

        for (const other of vectors) {
            if (other.row.id === source.row.id) continue;

            let dot = 0;
            for (let k = 0; k < source.vec.length; k++) {
                dot += source.vec[k] * other.vec[k];
            }
            const similarity = dot / (source.norm * other.norm);
            if (similarity >= GRAY_BAND_THRESHOLD) {
                scored.push({
                    id: other.row.id,
                    name: other.row.name,
                    similarity,
                });
            }
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        out.set(source.row.id, scored.slice(0, CANDIDATE_LIMIT));
    }

    return out;
}

/**
 * Mirrors `adjudicateIngredient` — deliberately a copy rather than an import,
 * because that lives in the API app and this is a database operation. If the
 * prompt there changes, change it here; the two disagreeing is exactly what a
 * check is for.
 */
async function adjudicate(
    name: string,
    shortlist: Candidate[]
): Promise<Candidate | null> {
    const { generateCompletion } = await import("@fridgeezy/llm");

    try {
        const { text } = await generateCompletion({
            model: { openai: "gpt-4o-mini" },
            label: "check.identity",
            system: `You classify ingredient names for a cooking database.

Given an ingredient NAME and a numbered list of CANDIDATE existing ingredients, decide whether NAME is one of them.

- "same": NAME is the same ingredient as one candidate — a synonym, regional name, or spelling variant. Set "match" to that candidate's number.
- "new": NAME is a real, distinct culinary ingredient, different from EVERY candidate.

Default to "new". Only answer "same" when NAME and the candidate are DIFFERENT WORDS FOR THE SAME THING — a regional name, a spelling variant, or a translation. "spring onion" is "scallion"; "cilantro" is "coriander"; "crayfish" is "crawfish"; "minced pork" is "ground pork"; "aubergine" is "eggplant".

If the two names differ by a QUALIFIER rather than by vocabulary, answer "new". This holds even when the qualified thing is obviously a kind of the other, and even when one name contains the other:
- "whole wheat flour" is NOT "flour". "rice flour" is NOT "flour".
- "iceberg lettuce" is NOT "lettuce". "kewpie mayonnaise" is NOT "mayonnaise".
- "back bacon" is NOT "bacon". "green olives" is NOT "olives".
- "thai basil" is NOT "basil". "duck egg" is NOT "egg". "brown sugar" is NOT "sugar".
- "dried oregano" is NOT "fresh oregano". "firm tofu" is NOT "tofu".

Do not reason about which one is the "default" or "everyday" form — that judgement is made elsewhere, from a curated alias list, and making it here produces exactly the wrong merges.

Ignore pure preparation words (chopped, minced, sliced, grated) — so "chopped parsley" IS "parsley".

Respond with a single JSON object and nothing else:
{"decision":"same"|"new","match":<candidate number or null>}`,
            user: `NAME: ${name}\nCANDIDATES:\n${shortlist
                .map((c, i) => `${i + 1}. ${c.name}`)
                .join("\n")}`,
            json: true,
            maxTokens: { openai: 40, bedrock: 1024 },
            effort: "low",
        });

        if (!text) return null;
        const parsed = JSON.parse(text) as { decision?: string; match?: number };
        if (parsed.decision !== "same") return null;
        const index = Number(parsed.match) - 1;
        return Number.isInteger(index) && index >= 0 && index < shortlist.length
            ? shortlist[index]
            : null;
    } catch {
        // Fail toward "create" — the recoverable direction, same as production.
        return null;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
