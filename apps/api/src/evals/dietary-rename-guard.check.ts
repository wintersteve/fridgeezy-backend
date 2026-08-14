import { preservesDietaryMarking } from "../modules/suggestions/services/verify-suggestion-authenticity";

/**
 * The rename guard's truth table. No database, no LLM, no API key — milliseconds.
 *
 * Sibling of `batch-dedup.check.ts`, and here for the same reason: what this
 * protects is a property that "usually holds" is not good enough for. The gate's
 * prompt has asked twice, in plain language and with a verbatim example, that a
 * dietary qualifier never be added or a tradition marker never dropped — and a
 * --repeat=5 baseline on 2026-08-14 still produced seven violations in one run.
 * The guard is what makes it hold; this is what stops the guard regressing.
 *
 * Every "refuse" row below is a rename that actually happened.
 *
 *   npx nx run @fridgeezy/api:check-dietary-rename
 */
const CASES: Array<[current: string, proposed: string, allow: boolean, why: string]> = [
    // Observed violations — all must now be refused.
    ["Thai Drunken Noodles Jay", "Vegan Drunken Noodles", false, "loses Jay, gains Vegan"],
    ["Thai Rice Noodle Soup Jay", "Vegan Thai Rice Noodle Soup", false, "loses Jay, gains Vegan"],
    ["Thai Drunken Noodles", "Vegan Drunken Noodles", false, "gains Vegan"],
    ["Thai Glass Noodle Salad", "Vegan Glass Noodle Salad", false, "gains Vegan"],
    ["Pad Thai Jay", "Vegan Pad Thai", false, "loses Jay, gains Vegan"],

    // Laundering: an adaptation stripped back onto the authentic dish's name.
    ["Vegan Pad Thai", "Pad Thai", false, "strips Vegan onto the real name"],
    ["Gluten-Free Ramen", "Ramen", false, "strips Gluten Free (hyphenated)"],

    // The one improving move, which must stay allowed.
    ["Vegan Pad Thai", "Pad Thai Jay", true, "qualifier -> attested tradition name"],

    // Ordinary renames the gate exists to make. Refusing these would be a
    // regression in the other direction.
    ["Murgh Makhani", "Butter Chicken", true, "ordinary rename"],
    ["Apple Tarte Tatin", "Tarte Tatin", true, "strips a NON-dietary qualifier"],
    ["Pasta Alfredo", "Fettuccine Alfredo", true, "ordinary rename"],
    ["Stir-Fried Beef with Broccoli", "Beef and Broccoli", true, "ordinary rename"],
    ["Pad Thai Jay", "Pad Thai Jay", true, "unchanged"],

    // "Vegetable" is not "Vegetarian", and substring matching would fail this.
    ["Vegetable Biryani", "Veg Biryani", true, "no dietary marker either side"],
];

let pass = 0;
let fail = 0;

for (const [current, proposed, allow, why] of CASES) {
    const got = preservesDietaryMarking(current, proposed);
    const ok = got === allow;

    console.log(
        `  ${ok ? "✓" : "✗"} ${allow ? "allow " : "refuse"} "${current}" -> "${proposed}"  (${why})`
    );

    if (ok) pass++;
    else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
