import { supabaseAdmin } from "@fridgeezy/supabase";
import {
    canonicalizeName,
    foldAccents,
    ingredientCanonicalId,
    suggestionCanonicalId,
} from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * The canonical-id rules are written TWICE — once in SQL, once in
 * `@fridgeezy/toolkit` — and this asserts the two copies still agree.
 *
 * ## Why a divergence is worse than a bug
 *
 * Nothing raises when they disagree. The app computes an id, asks the database
 * for that row, and is told there is no such row — which is indistinguishable
 * from "this ingredient is new", so a SECOND row is created. The catalogue then
 * holds two identities for one thing and every ingredient filter answers with
 * half of what it has. That is exactly how `brussel_sprout` / `brussels_sprout`
 * happened, and how `Jalapeño` / `Jalapeno` happened after it.
 *
 * The accent fold added on 2026-09-13 made this check overdue rather than
 * creating the need for it: there were already four rules on each side with no
 * guard that they matched.
 *
 * ## What it does NOT cover
 *
 * `canonicalizeName` has no SQL counterpart by design — it is for comparing two
 * JS-normalised names to each other — so it is only checked for FOLD agreement,
 * not for id agreement. The three rules it is routinely confused with are
 * asserted against their real SQL owners.
 *
 * Runs against whatever `apps/database/.env` points at (local, by default). No
 * LLM, no embeddings, no writes — it only calls immutable functions.
 */

/**
 * Names chosen to break things, not to pass.
 *
 * Every accented entry is a real row from the dev catalogue or a real dish name
 * the generator has produced; the rest cover the edges the three rules are
 * documented to disagree on — leading and trailing punctuation, plurals that
 * must not be singularised, and the `ss`/`us`/`is` endings.
 */
const NAMES = [
    "Béchamel",
    "Bechamel",
    "Béchamel Sauce",
    "Crème Fraîche",
    "Jalapeño Pepper",
    "Gruyère Cheese",
    "Ragù",
    "Duck à l'Orange",
    "Salade Niçoise",
    "Pâté en Croûte",
    "Moules Marinières",
    "Soufflé",
    "Twaróg",
    "Linguiça Sausage",
    "Bánh Hỏi",
    "Tarte Tatin",
    "Sunomono!",
    " Apfelstrudel! ",
    "Brussels Sprouts",
    "Cherries",
    "Tomatoes",
    "Asparagus",
    "Glass Noodles",
    "Miso",
    "Crème Brûlée",
];

let failures = 0;
let checks = 0;

function compare(rule: string, input: string, js: string, sql: string): void {
    checks++;

    if (js === sql) return;

    failures++;
    console.error(
        `  FAIL ${rule}  ${JSON.stringify(input)}\n       js:  ${JSON.stringify(js)}\n       sql: ${JSON.stringify(sql)}`
    );
}

async function sqlCall(fn: string, args: Record<string, string>): Promise<string> {
    const { data, error } = await supabaseAdmin.rpc(
        fn as never,
        args as never
    );

    if (error) {
        throw new Error(`${fn}(${JSON.stringify(args)}) failed: ${error.message}`);
    }

    return (data ?? "") as unknown as string;
}

async function main() {
    console.log(
        `Comparing ${NAMES.length} names across 4 rules against ${process.env.SUPABASE_URL}\n`
    );

    for (const name of NAMES) {
        // 1. The fold itself. Everything below is built on it, so a divergence
        //    here explains every other failure in one line.
        compare(
            "fold_accents      ",
            name,
            foldAccents(name),
            await sqlCall("fold_accents", { p_text: name })
        );

        // 2. `normalize_to_canonical_id` — the generated `recipes.canonical_id`,
        //    mirrored in JS by `sqlCanonicalId` in the recipes repository. That
        //    one is module-private, so the rule is restated here; if this is the
        //    copy that drifts, the check still catches the SQL side moving.
        const sqlCanonicalIdJs = foldAccents(name)
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/_+/g, "_")
            .toLowerCase();

        compare(
            "normalize_to_canon",
            name,
            sqlCanonicalIdJs,
            await sqlCall("normalize_to_canonical_id", { input_text: name })
        );

        // 3. `ingredient_canonical_id` — folds, collapses, trims edges, then
        //    singularises the LAST token only.
        compare(
            "ingredient_canon  ",
            name,
            ingredientCanonicalId(name),
            await sqlCall("ingredient_canonical_id", { input_text: name })
        );

        // 4. The suggestion/category/tag-alias TRIGGER rule. There is no
        //    function to call, so the trigger's expression is reproduced in SQL
        //    exactly as the trigger writes it — if the trigger changes and this
        //    does not, the next check to fail is `check-ingredient-identity`,
        //    which is far more expensive to run.
        compare(
            "trigger_canon     ",
            name,
            suggestionCanonicalId(name) ?? "",
            (
                await sqlCall("normalize_to_canonical_id", {
                    input_text: name.trim(),
                })
            ).replace(/^$/, "")
        );

        // `canonicalizeName` has no SQL owner — checked only for the fold, via
        // the assertion above — but its relationship to the trigger rule is
        // documented and worth holding: they differ ONLY at the edges.
        checks++;
        const trimmedEdges = (suggestionCanonicalId(name) ?? "").replace(
            /^_+|_+$/g,
            ""
        );

        if ((canonicalizeName(name) ?? "") !== trimmedEdges) {
            failures++;
            console.error(
                `  FAIL canonicalizeName  ${JSON.stringify(name)}\n` +
                    `       expected the trigger rule minus edge underscores: ${JSON.stringify(trimmedEdges)}\n` +
                    `       got: ${JSON.stringify(canonicalizeName(name) ?? "")}`
            );
        }
    }

    console.log(
        `${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} comparisons agree`
    );

    if (failures > 0) {
        console.error(
            "\nA divergence here is SILENT in production: the app computes an id," +
                " finds no row, and creates a duplicate. Fix both sides together."
        );
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
