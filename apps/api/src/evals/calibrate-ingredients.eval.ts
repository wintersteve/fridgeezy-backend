import { generateEmbedding } from "@fridgeezy/openai";
import { config } from "dotenv";

config();

/**
 * Ingredient-threshold calibration. match-ingredients embeds the ingredient NAME
 * and vector-searches; >= ACCEPT_THRESHOLD (0.85) auto-accepts, [GRAY (0.70),
 * ACCEPT) goes to the LLM, below GRAY is treated as no candidate. This measures
 * the real name-embedding cosine for synonym vs distinct pairs so those two
 * thresholds can be set from data.
 */
function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Synonyms — the SAME ingredient; want them at least in the gray band.
const SAME: Array<[string, string]> = [
    ["scallion", "green onion"],
    ["cilantro", "coriander"],
    ["eggplant", "aubergine"],
    ["chickpea", "garbanzo bean"],
    ["shrimp", "prawn"],
    ["yellow onion", "yellow onions"],
    ["bell pepper", "capsicum"],
];

// Distinct ingredients — want them below the gray band (created as new).
const DIFFERENT: Array<[string, string]> = [
    ["olive oil", "sesame oil"],
    ["cumin", "coriander"],
    ["basil", "mint"],
    ["salt", "sugar"],
    ["chicken breast", "chicken thigh"],
    ["butter", "margarine"],
];

// Same base, more specific — the adjudicator treats these as NOT the same;
// useful to see where they land (they should reach the gray band, not auto-merge).
const SPECIFICITY: Array<[string, string]> = [
    ["olive oil", "extra virgin olive oil"],
    ["rice", "basmati rice"],
];

async function score(a: string, b: string): Promise<number> {
    const [ea, eb] = await Promise.all([
        generateEmbedding(a),
        generateEmbedding(b),
    ]);
    return cosine(ea, eb);
}

async function run(label: string, pairs: Array<[string, string]>) {
    console.log(`\n${label}:`);
    const scores: number[] = [];
    for (const [a, b] of pairs) {
        const s = await score(a, b);
        scores.push(s);
        console.log(`  ${s.toFixed(3)}  ${a} ↔ ${b}`);
    }
    return scores;
}

async function main() {
    const same = await run("SYNONYMS (same ingredient — want gray/accept)", SAME);
    const diff = await run("DISTINCT (different — want below gray)", DIFFERENT);
    const spec = await run("SPECIFICITY (same base, more specific)", SPECIFICITY);

    console.log("\n" + "=".repeat(46));
    console.log(`synonyms   : min ${Math.min(...same).toFixed(3)}  max ${Math.max(...same).toFixed(3)}`);
    console.log(`distinct   : min ${Math.min(...diff).toFixed(3)}  max ${Math.max(...diff).toFixed(3)}`);
    console.log(`specificity: min ${Math.min(...spec).toFixed(3)}  max ${Math.max(...spec).toFixed(3)}`);
    console.log(
        "\nGuidance: GRAY floor should sit below the synonym min (so real synonyms\n" +
            "reach the LLM) but above the distinct max (so unrelated pairs don't).\n" +
            "ACCEPT should sit above the distinct+specificity max (auto-accept only\n" +
            "what's unambiguously the same)."
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Calibration failed:", error);
        process.exit(1);
    });
