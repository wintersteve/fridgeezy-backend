import { parseShelfLife } from "./shelf-life-rule";

/**
 * Does the shelf-life rule read the catalogue's sentences the way it claims to?
 *
 *   npx nx run @fridgeezy/database:check-shelf-life
 *
 * Offline, no database, no spend. Every string below is verbatim from
 * `ingredients.shelf_life` on the dev project (read-only, 2026-09-04), chosen to
 * cover each shape the 106 distinct sentences take rather than to be a sample.
 *
 * It guards the two halves of the rule that a reader cannot check by eye once
 * 347 rows have been written — first clause and low end — plus the two cases
 * where doing nothing is the correct answer.
 */

let failures = 0;
let checks = 0;

const check = (label: string, condition: boolean) => {
    checks++;
    if (!condition) failures++;
    console.log(`  ${condition ? "✓" : "✗"} ${label}`);
};

const days = (text: string) => parseShelfLife(text)?.days ?? null;

console.log("The FIRST clause wins — the sentence is written fresh-state first");
check(
    "1-2 days refrigerated, 3 months frozen -> 1",
    days("1-2 days refrigerated, 3 months frozen") === 1
);
check(
    "1 week fresh, 1 year frozen -> 7",
    days("1 week fresh, 1 year frozen") === 7
);
check(
    "1 week fresh, 4 weeks cured -> 7",
    days("1 week fresh, 4 weeks cured") === 7
);
check(
    "6 months in pantry, 1 year refrigerated -> 180",
    days("6 months in pantry, 1 year refrigerated") === 180
);
check(
    "3-4 years whole, 2-3 years ground -> 1095",
    days("3-4 years whole, 2-3 years ground") === 1095
);

console.log("\nThe LOW end of a range — an early prompt beats a stale ranking");
check("1-2 days -> 1", days("1-2 days") === 1);
check("3-5 days refrigerated -> 3", days("3-5 days refrigerated") === 3);
check("2-3 weeks -> 14", days("2-3 weeks") === 14);
check("18-24 months unopened -> 540", days("18-24 months unopened") === 540);
check("2-4 years -> 730", days("2-4 years") === 730);

console.log("\nA range that crosses units still takes the first number's unit");
check("6 months-2 years -> 180", days("6 months-2 years") === 180);

console.log("\nUnits");
check("3 days refrigerated -> 3", days("3 days refrigerated") === 3);
check("1 week refrigerated -> 7", days("1 week refrigerated") === 7);
check("3 months -> 90", days("3 months") === 90);
check("1 year -> 365", days("1 year") === 365);
// Stated rather than reconciled — see UNIT_DAYS.
check("12 months -> 360, and 1 year -> 365", days("12 months") === 360);

console.log("\nPreamble and trailing conditions are ignored, not parsed");
check(
    "up to 2 years if stored in a cool, dry place -> 730",
    days("up to 2 years if stored in a cool, dry place") === 730
);
check(
    "3-6 months in an airtight container -> 90",
    days("3-6 months in an airtight container") === 90
);
check("2 weeks ground beans -> 14", days("2 weeks ground beans") === 14);

console.log("\nIndefinite is an ANSWER — false with no number, not a failure");
for (const text of [
    "Indefinite",
    "Indefinite if stored properly",
    "Indefinite if stored in a dry environment",
]) {
    const parsed = parseShelfLife(text);
    check(
        `${JSON.stringify(text)} -> never expires`,
        parsed !== null && parsed.expires === false && parsed.days === null
    );
}

console.log("\nA sentence with no duration is LEFT ALONE, never guessed at");
check(
    "Several months refrigerated -> null",
    parseShelfLife("Several months refrigerated") === null
);
check("an empty string -> null", parseShelfLife("   ") === null);
check(
    "a sentence with a number but no unit -> null",
    parseShelfLife("keeps for 3") === null
);

console.log(`\n${checks - failures}/${checks} passed`);

if (failures > 0) process.exitCode = 1;
