import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Fill the pairing corpus ahead of the readers, so nobody meets a cold dish.
 *
 *   npx nx run @fridgeezy/database:warm-dish-pairings -- --limit 10
 *   npx nx run @fridgeezy/database:warm-dish-pairings -- --dry-run
 *
 * A pairing set is generated once per dish and read by everybody afterwards
 * (see `20260916000001`), which makes the first reader of each dish the one who
 * pays — and there is nothing they did to deserve that. The picker handles it
 * honestly: the generation sits behind a deliberate press, and the sheet says
 * so. This is how that press stops being the normal experience.
 *
 * ## It goes through the API, not the model
 *
 * Deliberately: `POST /rest/recipes/:id/pairings/generate` already owns the
 * whole procedure — the prompt, the course clamp, the component drop, the
 * notability gate inside `persistOrReuseSuggestion`, the cache write and the
 * self-pairing guard. A warming script that called the model directly would be
 * a second copy of all of it, free to drift, and the drift would show up as a
 * corpus whose warmed dishes obey different rules from its cold ones.
 *
 * So this needs a running API and a token for it. On the local stack that is
 * `npm run api:dev` plus a user JWT; against production it is the deployed
 * Function URL. **Nothing here can run offline**, unlike the `check-*`
 * operations beside it — this one spends money, which is the whole point of it
 * being a deliberate operation rather than a cron.
 *
 * ## Which dishes, and in what order
 *
 * Catalogue recipes only (`created_by is null`), because an imported recipe is
 * one profile's and a shared pairing set about it would be a small leak — its
 * name would appear in another reader's picker. Most-favourited first, since a
 * dish nobody has saved is a dish nobody is composing around yet.
 *
 * Skips anything that already has a set, so it is safe to re-run and safe to
 * interrupt.
 */

interface Options {
    limit: number;
    dryRun: boolean;
    baseUrl: string;
    token: string | undefined;
    /** Pause between calls, so a warm run does not look like an attack. */
    delayMs: number;
}

const readOptions = (): Options => {
    const args = process.argv.slice(2);
    const flag = (name: string): string | undefined => {
        const index = args.indexOf(`--${name}`);
        return index >= 0 ? args[index + 1] : undefined;
    };

    return {
        limit: Number(flag("limit") ?? 10),
        dryRun: args.includes("--dry-run"),
        baseUrl:
            flag("url") ??
            process.env.PAIRINGS_API_URL ??
            "http://127.0.0.1:8000/rest",
        token: flag("token") ?? process.env.PAIRINGS_API_TOKEN,
        delayMs: Number(flag("delay") ?? 1500),
    };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Catalogue dishes with no pairing set, most-favourited first.
 *
 * The `not.in` filter is built from the ids already warmed rather than from a
 * join, because PostgREST cannot anti-join and the alternative — fetching every
 * recipe and filtering in memory — would be the same query with the work moved.
 * The set table is small by construction (one row per dish), so reading it
 * whole is cheap and stays cheap.
 */
async function coldDishes(limit: number) {
    const { data: warmed, error: warmedError } = await supabaseAdmin
        .from("dish_pairing_sets")
        .select("main_dish_key");

    if (warmedError) throw new Error(`reading warmed sets: ${warmedError.message}`);

    const warm = new Set((warmed ?? []).map((row) => row.main_dish_key));

    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name, source_suggestion_id, favourite_count")
        .is("created_by", null)
        .is("base_recipe_id", null)
        .order("favourite_count", { ascending: false })
        .limit(limit * 4);

    if (error) throw new Error(`reading recipes: ${error.message}`);

    return (data ?? [])
        .map((row) => ({
            id: row.id,
            name: row.name,
            dishKey: row.source_suggestion_id ?? row.id,
            favourites: row.favourite_count ?? 0,
        }))
        // One request per DISH, not per row: a family's copies share a key, so
        // without this a dish at three difficulties would be warmed three times
        // and the last two would be no-ops that still cost a round trip.
        .filter((dish, index, all) => {
            if (warm.has(dish.dishKey)) return false;
            return all.findIndex((other) => other.dishKey === dish.dishKey) === index;
        })
        .slice(0, limit);
}

async function main() {
    const options = readOptions();
    const dishes = await coldDishes(options.limit);

    console.log(
        `${dishes.length} cold dish${dishes.length === 1 ? "" : "es"} to warm` +
            (options.dryRun ? " (dry run)" : "")
    );

    if (dishes.length === 0) return;

    if (options.dryRun) {
        for (const dish of dishes) {
            console.log(`  · ${dish.name} (${dish.favourites} ♥)`);
        }
        return;
    }

    if (!options.token) {
        throw new Error(
            "A Supabase access token is required — pass --token or set PAIRINGS_API_TOKEN. " +
                "Every /rest route is authenticated; see the local JWT probe in CLAUDE.md."
        );
    }

    let warmed = 0;
    let empty = 0;
    let failed = 0;

    for (const dish of dishes) {
        try {
            const response = await fetch(
                `${options.baseUrl}/recipes/${dish.id}/pairings/generate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${options.token}`,
                    },
                    body: JSON.stringify({
                        courseTypes: ["appetizer", "side", "dessert"],
                        perCourse: 6,
                        blacklist: [],
                        dietaryRestrictions: [],
                    }),
                }
            );

            if (!response.ok) {
                failed++;
                console.log(
                    `  ✗ ${dish.name} — ${response.status} ${await response.text()}`
                );
                continue;
            }

            const body = (await response.json()) as {
                courses: string[];
                candidates: unknown[];
            };

            // An endorsed-nothing dish is a SUCCESS, and counting it separately
            // is what makes a warm run legible: a corpus where half the dishes
            // pair with nothing is either a very particular catalogue or a
            // prompt that has stopped endorsing anything, and the two look
            // identical in a total.
            if (body.courses.length === 0) {
                empty++;
                console.log(`  · ${dish.name} — eaten on its own`);
            } else {
                warmed++;
                console.log(
                    `  ✓ ${dish.name} — [${body.courses.join(", ")}], ${body.candidates.length} candidates`
                );
            }
        } catch (error) {
            failed++;
            console.log(`  ✗ ${dish.name} — ${(error as Error).message}`);
        }

        await sleep(options.delayMs);
    }

    console.log(
        `\n${warmed} warmed, ${empty} eaten alone, ${failed} failed out of ${dishes.length}`
    );

    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
