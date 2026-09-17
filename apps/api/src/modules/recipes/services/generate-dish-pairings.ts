import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import { GenerateSuggestionResponseSchema } from "@fridgeezy/schemas";

import type { PairingSeed } from "./load-seed-dish";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import {
    ADAPTED_FOR_RULE,
    FOOD_ONLY_RULE,
} from "../../suggestions/services/constraint-rules";
import { DIFFICULTY_RULE } from "../../suggestions/services/difficulty-rules";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "../../suggestions/services/naming-rules";
import { persistOrReuseSuggestion } from "../../suggestions/services/persist-or-reuse-suggestion";
import { createSuggestionBatch } from "../../suggestions/services/suggestion-batch";
import {
    COMPONENT_RULE,
    COURSE_IS_A_DISH_RULE,
    COURSE_RULE,
    DISH_FORM_RULE,
    TAGS_KEY_RULE,
} from "../../suggestions/services/tagging-rules";
import { DISH_TOTAL_TIME_RULE } from "../../suggestions/services/timing-rules";

import { fetchRecipeMetadata } from "./fetch-recipe-metadata";

/**
 * The courses a pairing set may endorse.
 *
 * `main` is deliberately absent and this is not an oversight. A pairing set is
 * always ABOUT a main — the dish it is keyed on — so a second one is not a
 * course to serve alongside, it is a different dinner. The client's
 * `COURSE_BUILD_ORDER` drops the slot the seed already fills for the same
 * reason; here it can simply never be asked for.
 */
export const PAIRING_COURSES = ["appetizer", "side", "dessert"] as const;

/**
 * How many dishes the model is asked for, per course it endorses.
 *
 * SIX, up from four (owner's call, 2026-09-16), and the change is about what
 * arrives rather than what is asked for. Between here and the picker there are
 * three lossy steps, and they compound: the model often names fewer than it was
 * asked for, `persistOrReuseSuggestion` resolves two of its names onto one
 * existing row, and the notability gate refuses some outright. Asking for four
 * was measured against the floor the picker needs and left no room for any of
 * that — a course could be asked for four dishes and end up offering ONE, which
 * is a choice of nothing.
 *
 * Six is also what the picker can draw: `MAX_COURSE_CANDIDATES` is six, so this
 * is the number that fills it rather than a number that overshoots it. The cost
 * argument has not changed and is still the reason it is not higher — each dish
 * costs a review, an embedding and three dedup layers, which is most of a
 * batch's tokens — but it is paid ONCE per dish and read by everybody
 * afterwards, so the number wants to be the useful one.
 *
 * `PAIRING_FLOOR` on the client is the other half: below three a course says so
 * rather than offering what it has. Raising this is what makes that floor
 * survivable after a reader's own blacklist has taken one or two out.
 */
export const PAIRINGS_PER_COURSE = 6;

/**
 * What a set may hold in total, whatever the model returns.
 *
 * Three courses at four dishes is the intended shape. The ceiling exists
 * because the model decides how many courses to endorse and a JSONL stream has
 * no natural end — a model that endorsed four courses and produced eight dishes
 * each would persist thirty-two dishes on one unattended request.
 */
export const MAX_PAIRINGS_PER_SET = PAIRING_COURSES.length * PAIRINGS_PER_COURSE;

/**
 * Which courses this dish actually wants, alone on the first line.
 *
 * The one judgement in this prompt that is not about naming a dish, and the
 * whole reason the endpoint exists rather than three per-course lookups: a
 * one-pot stew wants no side, a sandwich wants no dessert, and the picker has
 * always drawn all three rows regardless — three invitations to add something
 * that does not belong.
 *
 * Emitted FIRST so the set's shape is known before any dish is persisted, which
 * is what lets a run that produces nothing still record an honest answer.
 */
const PAIRING_COURSES_RULE = `courses — which courses are worth serving with this dish, alone on the FIRST line as {"courses": ["side", "dessert"]} and carrying no other keys. Rules:
  - Choose only from: appetizer, side, dessert. Never "main" — the dish above IS the main.
  - Endorse a course only if a cook would genuinely serve one with this dish, in the tradition the dish comes from. A hearty one-pot stew or a laden sandwich usually needs no side. A rich dessert-like dish needs no dessert. A light appetizer-sized dish is not a main to build around at all.
  - It is entirely correct to return an EMPTY array. Some dishes are eaten alone, and saying so is more useful than inventing an accompaniment nobody would serve.
  - Do NOT endorse a course merely because it is conventional to have one. Two well-chosen courses beat three where one is filler.
  - READ THE OCCASION, not just the course tag. A breakfast or brunch plate, a snack, a light lunch or a single-plate dish is not a dinner to build courses around — a dessert after avocado toast is nobody's meal. Many such dishes endorse nothing at all. Courses belong to a dish somebody sits down to as a MEAL.`;

/**
 * What a proposed dish must be.
 *
 * This is the rule that separates a PAIRING from a FILTER, which is the whole
 * change: the picker used to show dishes that shared a course tag and a cuisine
 * with the main, and neither of those facts says the two go together.
 */
const PAIRING_DISH_RULE = `Each dish must be one a cook would actually serve WITH the dish above, at the same meal.
  - The test is the meal, not the label. "Also Tuscan" is not a reason; "this is what is on the table when Tuscans eat ribollita" is.
  - Prefer dishes with a real tradition of being served together. A classic pairing beats a defensible one.
  - The accompaniment must BALANCE the main, not repeat it: do not pair a rich braise with a rich gratin, or a pasta main with a pasta side.
  - Return FEWER dishes rather than reaching. A course with two genuine pairings is better than one with four where two are filler.
  - Never return the dish above, a variation on it, or a component of it.`;

/** The meal shape the model decided on, tried FIRST. */
const PairingCoursesSchema = z.object({
    courses: z.array(z.string()),
});

const COURSES_SCHEMA_INDEX = 1;

/**
 * One proposed dish, in the shape `persistOrReuseSuggestion` already consumes.
 *
 * Deliberately the same fields `ComposeRecipeSuggestionSchema` carries, minus
 * nothing: the object is handed straight to that function, which types it as
 * `GenerateSuggestionResponseDto`, so a field dropped here is a field the
 * catalogue row loses. `total_time_minutes` is borrowed from the shared schema
 * rather than restated, for the reason compose records — the coercion, the
 * bounds and the optional/catch order all have to stay in step with that file.
 */
const PairingDishSchema = z.object({
    name: z.string(),
    name_alt: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    total_time_minutes: GenerateSuggestionResponseSchema.shape.total_time_minutes,
    course: z.string(),
    ingredients: z.array(z.string().min(1)),
    tags: z.array(z.string()),
    adaptedFor: z.array(z.string()).default([]),
});

type PairingDish = z.infer<typeof PairingDishSchema>;

/**
 * What a TARGETED call asks for instead of choosing courses.
 *
 * The reader opened a course the model did not endorse — an appetizer beside a
 * Tuna Tataki — and asking the original prompt again would just get the same
 * refusal, because its first job is deciding whether the course belongs. This
 * one skips that decision: the course is a given, name dishes for it.
 *
 * It still may return nothing. "Name me an appetizer for this" is a question
 * with an honest empty answer, and reaching for a filler dish is worse than
 * the course staying empty — which is why the last line is the same rule the
 * untargeted prompt carries.
 */
const targetedCoursesRule = (courses: string[], perCourse: number): string =>
    `The reader has asked specifically for: ${courses.join(", ")}.

  - Do NOT emit a "courses" line. The courses are decided; you are naming dishes for them.
  - Name up to ${perCourse} dishes for EACH course listed above, and give each dish that course.
  - The reader has asked for these knowing they are not the obvious accompaniment, so do not refuse on the grounds that the dish does not usually take one. Name what a cook WOULD serve if they were serving that course.
  - It is still correct to return nothing at all for a course if no real dish would honestly go there. Returning fewer beats reaching for filler.`;

const buildSystemPrompt = (target?: string[], choose = true): string => `You are a menu companion. Given one dish, ${
    choose
        ? "decide what a cook would actually serve alongside it, and name those dishes."
        : "name dishes for the courses the reader has asked for."
}

## Rules
${PAIRING_DISH_RULE}
- ${FOOD_ONLY_RULE}
  - This applies to PAIRINGS too. A wine or a cocktail that would go well with the dish is still a drink, and a course here is always something eaten.
- ${COURSE_IS_A_DISH_RULE}
- Every dish must be a real, authentic dish, named by the rule under "Output Format" below. Never invent one.

## Who is eating
Nobody in particular. **You are not being told anyone's diet or dislikes, and you must not guess at any.** This answer describes the dish, not a reader — it is stored once and shown to everybody, and each reader's own restrictions are applied when it is read. Do not narrow the dishes to suit an imagined eater, and do not offer a "vegan option" unless the pairing genuinely is one.

${DIFFICULTY_RULE}

## Tagging Rules (CRITICAL)
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags per dish. One for almost every dish — its actual origin. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- ${COURSE_RULE}
  - Here this is the course the dish is being PROPOSED for, and it must be one you endorsed on the first line.
- ${DISH_FORM_RULE}
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free)

## Ingredients
- MUST be singular
- Include key ingredients that define the dish

## Output Format
Output one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

${
    choose
        ? `The FIRST line decides the shape of the meal:
- ${PAIRING_COURSES_RULE}${
              target?.length
                  ? `

**The reader has already opened: ${target.join(", ")}.** Name dishes for it whether or not you endorse it — they have asked. Put it on the "courses" line ONLY if it genuinely belongs; endorsing and naming are separate questions here, and it is still correct to name nothing if no real dish would honestly go there.`
                  : ""
          }`
        : targetedCoursesRule(target ?? [], PAIRINGS_PER_COURSE)
}

Every line is one dish, and must include:
- ${DISH_NAME_RULE}
- ${DISH_NAME_ALT_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- ${DISH_TOTAL_TIME_RULE}
- course (one of the courses named above)
- ingredients (array of key ingredient strings)
- ${ADAPTED_FOR_RULE}
- ${TAGS_KEY_RULE}`;

const buildUserPrompt = (
    dish: PairingSeed,
    cuisineTags: string[],
    perCourse: number,
    target?: string[],
    /** Dish names the course already holds — see the rule this appends. */
    exclude?: string[]
): string => {
    const parts = [
        `Dish: ${dish.name}`,
        `Description: ${dish.description}`,
        `Key Ingredients: ${dish.ingredients
            .slice(0, 8)
            .map((ingredient) => ingredient.name)
            .join(", ")}`,
        `Difficulty: ${dish.difficulty}`,
    ];

    if (cuisineTags.length > 0) {
        parts.push(`Cuisine: ${cuisineTags.join(", ")}`);
    }

    parts.push(
        target?.length
            ? `\nName up to ${perCourse} dishes for each of: ${target.join(", ")}.`
            : `\nDecide which of appetizer, side and dessert are worth serving with this dish, then name up to ${perCourse} dishes for each course you endorsed.`
    );

    // LAST, and stated as a hard rule rather than as context. Without it a
    // top-up is a paid call that names the dishes the course already holds:
    // `record_dish_pairings` drops them on the unique constraint and the course
    // is exactly as thin as it was. The names are what the model works in —
    // dish keys would mean nothing to it.
    if (exclude?.length) {
        parts.push(
            `\nThese are ALREADY offered for this dish. Do not name any of them, or anything that is the same dish under another name: ${exclude.join(", ")}.`
        );
    }

    return parts.join("\n");
};

/**
 * Both halves of the prompt, for one dish.
 *
 * Exported so `dish-pairings.eval.ts` measures the SHIPPED rules rather than a
 * paraphrase of them. An eval against a local copy of a prompt is an eval that
 * passes while the real prompt regresses, which is worse than no eval at all —
 * and the courses judgement this feature turns on lives entirely in the system
 * text below.
 *
 * It resolves the cuisine vocabulary itself, so a caller needs nothing but the
 * dish.
 */
export async function buildPairingPrompts(
    dish: PairingSeed,
    perCourse: number = PAIRINGS_PER_COURSE,
    /** Courses the reader asked for outright — see `targetedCoursesRule`. */
    target?: string[],
    /** False once a set exists: the courses are the request, not a question. */
    choose = true,
    /** Dish names the targeted courses already hold, for a top-up. */
    exclude?: string[]
): Promise<{ system: string; user: string }> {
    const metadata = await fetchRecipeMetadata();
    const cuisineTagNames = metadata.tags
        .filter((tag) => tag.type === "cuisine")
        .map((tag) => tag.name);

    return {
        system: buildSystemPrompt(target, choose),
        user: buildUserPrompt(
            dish,
            matchCuisines(dish, cuisineTagNames),
            perCourse,
            target,
            exclude
        ),
    };
}

/**
 * The dish's cuisines, matched against the real vocabulary.
 *
 * Positively matched rather than "the first tag that is not a course", which
 * also matches DIETARY tags — the bug compose records, where a vegan Italian
 * dish sent the model `Cuisine: vegan`.
 */
const matchCuisines = (
    dish: PairingSeed,
    cuisineTagNames: string[]
): string[] =>
    dish.tags.filter((tag) =>
        cuisineTagNames.some(
            (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
        )
    );

/** One dish in a finished set, ready for `record_dish_pairings`. */
export interface GeneratedPairing {
    courseType: string;
    /** The identity `menu_courses.dish_key` uses, never the row id blindly. */
    dishKey: string;
    /** The row to open: a recipe when one exists, else the suggestion. */
    dishId: string;
    isRecipe: boolean;
    name: string;
    rank: number;
}

export interface DishPairingSet {
    /** The courses the model endorsed. May legitimately be empty. */
    courses: string[];
    /**
     * The courses this run SOLICITED dishes for.
     *
     * The endorsed set on an untargeted run — a course the model declined was
     * never asked for dishes, and recording it as asked is what would make the
     * course a dead end. The requested set on a targeted one.
     */
    asked: string[];
    pairings: GeneratedPairing[];
    /** What answered, recorded on the set so a stale model can be found later. */
    model: string;
}

const PAIRING_MODEL = "gpt-4.1";

/**
 * What goes with this dish, asked once and written to the corpus.
 *
 * The generated half of the pairing layer. `menu_pairings_for_recipe` is the
 * other half and is strictly better where it has anything to say — a dish
 * somebody actually served alongside this one, ranked by how many people kept
 * the meal — but it needs saved menus to exist, and a young catalogue has
 * almost none. Measured on 2026-09-16 the local catalogue held 56 recipes and
 * ONE publishable menu, so evidence covered two dishes out of fifty-six. This
 * is what fills the other fifty-four.
 *
 * ## It is not compose, and the difference is the point
 *
 * `generateComposeRecipes` builds ONE dinner: one dish per requested slot,
 * chosen to sit together, titled as a meal. This builds a SHORTLIST: several
 * alternatives per course, none of which have been chosen, so the reader
 * chooses. Compose answers "what shall I serve"; this answers "what could I
 * serve", and only the second can be cached — a shortlist is about the dish,
 * where a dinner is about the evening somebody was planning.
 *
 * ## Nothing here is per-reader
 *
 * No blacklist, no diet, no skill level, and the prompt says so in as many
 * words rather than merely omitting them — a model handed a dish and no eater
 * will otherwise hedge towards the middle. Both are applied when the set is
 * READ (`pairing_candidates_for_recipe`), which is the only way one stored
 * answer can serve everybody.
 *
 * It also makes the system prompt IDENTICAL across every call, which is worth
 * more than it looks: measured on 2026-09-16 the first call in a run reported
 * 4440 input tokens and 0 cached, and the next reported 221 input against 4224
 * CACHED. So a warming run over the catalogue pays the prompt once and the
 * per-dish cost collapses to the user turn. Anything that folds a reader's
 * constraints into the system text gives that up as well as the shared cache.
 *
 * ## What the dishes cost, which is most of it
 *
 * Four calls in that run produced seven `authenticity.verify` and seven
 * `adjudicate.ingredient` calls inside `persistOrReuseSuggestion` — so the
 * prompt above is the cheap half and the dishes are the expensive one. That is
 * the whole argument for {@link PAIRINGS_PER_COURSE} being four rather than
 * six, and for dropping a dish BEFORE that function wherever the drop is
 * knowable (a course that was not endorsed, a slot already full, a component
 * offered as a course).
 *
 * NEVER THROWS for a dish that simply has no pairings: an empty `courses` and an
 * empty `pairings` is a real answer, and the caller records it as one. It does
 * throw if the model call itself fails, because that is not an answer.
 */
export async function generateDishPairings(
    dish: PairingSeed,
    options: {
        /**
         * The dish's own `dish_key`, resolved by the caller.
         *
         * Passed in rather than derived here because `PairingSeed` does not
         * carry `source_suggestion_id` —
         * and guessing `dish.id` would be wrong for exactly the dishes this
         * matters for, the promoted ones. The caller has already looked it up
         * to read the cache, so this costs nothing.
         */
        mainDishKey: string;
        perCourse?: number;
        provider?: LlmProvider;
        /**
         * Courses the reader asked for outright, overriding the endorsement.
         *
         * Present means a TARGETED run: the model is not asked which courses
         * belong, it is told. `courses` comes back empty because a targeted run
         * makes no claim about what the dish wants — the caller merges, so the
         * stored endorsement is left alone.
         */
        targetCourses?: string[];
        /**
         * Whether the model still chooses which courses the dish wants.
         *
         * True on the FIRST call for a dish. `targetCourses` is honoured either
         * way — a reader who pressed Side gets sides named for them even when
         * the model would not have endorsed one, which is what makes a single
         * press enough. Without it, a dish the model declines wholesale
         * (Banana Bread) would answer the first press with nothing and need a
         * second to trigger a targeted call.
         */
        chooseCourses?: boolean;
        /**
         * Dish names the targeted courses already hold.
         *
         * Only a TOP-UP passes any: a course being asked for the first time
         * holds nothing. It is the difference between a second call that finds
         * new dishes and one that re-names the same ones and adds nothing —
         * `record_dish_pairings` drops a repeat on the unique constraint, so
         * without this the reader pays for a call and the course stays thin.
         */
        excludeNames?: string[];
    }
): Promise<DishPairingSet> {
    const {
        mainDishKey,
        perCourse = PAIRINGS_PER_COURSE,
        provider,
        targetCourses,
        chooseCourses = true,
        excludeNames,
    } = options;

    const targeted = (targetCourses ?? []).filter((course) =>
        (PAIRING_COURSES as readonly string[]).includes(course)
    );

    const metadata = await fetchRecipeMetadata();
    const cuisineTagNames = metadata.tags
        .filter((tag) => tag.type === "cuisine")
        .map((tag) => tag.name);
    const componentTagNames = metadata.tags
        .filter((tag) => tag.type === "component")
        .map((tag) => tag.name);
    // The whole course vocabulary, not just the three this prompt can endorse —
    // `resolveCourse` needs to tell a garbled label from a real course the
    // model named but did not endorse, and "main" is the case that matters.
    const courseTagNames = metadata.tags
        .filter((tag) => tag.type === "course")
        .map((tag) => tag.name);

    const cuisineTags = matchCuisines(dish, cuisineTagNames);

    const stream = generateStream({
        model: { openai: PAIRING_MODEL },
        label: "recipe.pairings",
        system: buildSystemPrompt(targeted, chooseCourses),
        user: buildUserPrompt(
            dish,
            cuisineTags,
            perCourse,
            targeted,
            excludeNames
        ),
        provider,
    });

    // Coordinates dedup between the dishes of THIS request, one step earlier
    // than the database would. Without it two courses can resolve to the same
    // dish: the loop awaits sequentially, so by the time the second runs the
    // first is already stored and the DB layers REUSE it — handing back a
    // second result with an identical id rather than dropping it.
    const batch = createSuggestionBatch();

    /**
     * The courses dishes may be filed under, or null until the first line lands.
     *
     * A TARGETED run starts with them in hand — the courses are the request, not
     * the model's to choose — which also means its dishes are not dropped
     * waiting for a `courses` line that the prompt told it not to emit.
     */
    let endorsed: string[] | null = chooseCourses ? null : targeted;

    /**
     * What the model ENDORSED, as distinct from what dishes may be filed under.
     *
     * They differ by the pressed course: a reader who opens a side on a dish
     * the model would not give one still gets sides named, and those have to
     * resolve — but the endorsement is the model's answer and must not be
     * widened by the asking.
     */
    let modelCourses: string[] = [];

    const pairings: GeneratedPairing[] = [];
    const perCourseCount = new Map<string, number>();

    /**
     * Every dish this set has committed to, by `dish_key`.
     *
     * The identity `record_dish_pairings` will store, NOT the row id: the same
     * dish is a suggestion row before anybody promotes it and a recipe row
     * after, so comparing ids would let one dish take a slot in two courses.
     */
    const usedKeys = new Set<string>();

    /**
     * Clamp the model's free-text course onto a slot it endorsed.
     *
     * `course` is `z.string()` off the LLM, so "Side", "side dish" and "entree"
     * all parse and all validate. Echoing one straight through would store a
     * `course_type` the picker reads nothing for — the dish generated,
     * reviewed, embedded, persisted, and then invisible. The same clamp compose
     * applies, and for the same reason.
     */
    const resolveCourse = (course: string): string | null => {
        const wanted = course.trim().toLowerCase();
        const allowed = endorsed ?? [];

        const exact = allowed.find((slot) => slot === wanted);
        if (exact) return exact;

        // A course the model NAMES but did not endorse is the model
        // contradicting itself one line later, not a misspelling — so it is
        // dropped rather than absorbed.
        //
        // This is where compose's rule does NOT transfer, and copying it here
        // was a bug. There, `allowedCourses` is what the CALLER asked for and
        // the model was told, so anything else is a spelling of one of them and
        // absorbing it costs nothing. Here the model chose the courses itself,
        // so "dessert" against an endorsement of `[side]` is a real dessert —
        // and absorbing it would offer a Tiramisu under SIDE.
        //
        // Matched against the DB's whole course vocabulary rather than
        // `PAIRING_COURSES`, so "main" is caught too: it is a course word this
        // prompt can never endorse, and a dish the model calls a main is not a
        // garbled side.
        const isRealCourse = courseTagNames.some(
            (name) => name.toLowerCase() === wanted
        );

        if (isRealCourse) return null;

        // Genuinely unrecognisable ("entree", "first"), and only one endorsed
        // course to mean. One honest answer, so a garbled label costs nothing
        // to absorb; with several there is no way to tell which was meant.
        return allowed.length === 1 ? allowed[0] : null;
    };

    for await (const { parsed, schemaIndex } of processJsonlStream(stream, [
        PairingDishSchema,
        PairingCoursesSchema,
    ])) {
        if (schemaIndex === COURSES_SCHEMA_INDEX) {
            // Only the first survives, and a targeted run has none: the courses
            // came from the reader, and a model that volunteered a line anyway
            // must not be able to narrow them. `endorsed` is already set there,
            // so this guard covers both.
            if (endorsed !== null) continue;

            const raw = (parsed as z.infer<typeof PairingCoursesSchema>).courses;

            const chosen = raw
                .map((course) => course.trim().toLowerCase())
                .filter((course): course is (typeof PAIRING_COURSES)[number] =>
                    (PAIRING_COURSES as readonly string[]).includes(course)
                );

            // What the model endorsed, kept apart from what dishes may be filed
            // under. The pressed course is admitted to the second and NOT the
            // first: the reader asked for it, so its dishes must not be dropped
            // by `resolveCourse` — but they did not change the model's opinion,
            // and `courses` is that opinion.
            modelCourses = [...new Set(chosen)];
            endorsed = [...new Set([...chosen, ...targeted])];

            continue;
        }

        // A dish before the courses line. The model was told to emit the shape
        // first and this is what happens when it does not: there is no set of
        // endorsed slots to clamp against, so the dish cannot be filed. Dropped
        // rather than guessed at — filing it under its own spelling is how a
        // dish ends up in a bucket nothing renders.
        if (endorsed === null) {
            console.warn(
                "[Pairings] dish arrived before the courses line — dropped"
            );
            continue;
        }

        if (endorsed.length === 0) continue;
        if (pairings.length >= MAX_PAIRINGS_PER_SET) continue;

        const proposal = parsed as PairingDish;
        const courseType = resolveCourse(proposal.course);

        if (!courseType) {
            console.warn(
                `[Pairings] dropped "${proposal.name}" — course "${proposal.course}" is not one of ${endorsed.join(", ")}`
            );
            continue;
        }

        // Dropped BEFORE `persistOrReuseSuggestion`, which is where the cost is:
        // the review alone is roughly three quarters of a batch's tokens, and
        // this dish was never going to be shown.
        if ((perCourseCount.get(courseType) ?? 0) >= perCourse) continue;

        // A building block offered as a course. `COURSE_IS_A_DISH_RULE` asks the
        // model not to and this is the half that enforces it — the generator is
        // the thing being policed, so it cannot also be the gate. Béchamel is
        // `well_known` at high confidence because it is, so the authenticity
        // gate lets it through; nothing else catches this.
        const offeredComponent = proposal.tags.find((tag) =>
            componentTagNames.some(
                (component) => tag.toLowerCase() === component.toLowerCase()
            )
        );

        if (offeredComponent) {
            console.warn(
                `[Pairings] dropped "${proposal.name}" — a ${offeredComponent} is not a ${courseType}`
            );
            continue;
        }

        const outcome = await persistOrReuseSuggestion(
            proposal,
            {
                cuisine: proposal.tags.find((tag) =>
                    cuisineTagNames.some(
                        (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
                    )
                ),
            },
            { batch }
        );

        if (outcome.kind === "dropped") {
            console.warn(
                `[Pairings] dropped "${proposal.name}" (${outcome.reason})`
            );
            continue;
        }

        const resolved =
            outcome.kind === "existing_recipe"
                ? {
                      // The family identity, so a pairing survives the dish
                      // being promoted and cannot be taken twice under two
                      // names. Exactly what `save_menu` computes.
                      dishKey:
                          outcome.recipe.sourceSuggestionId ?? outcome.recipe.id,
                      dishId: outcome.recipe.id,
                      isRecipe: true,
                      name: outcome.recipe.name,
                  }
                : {
                      // A suggestion IS its own dish key — it has no recipe to
                      // normalise through yet.
                      dishKey: outcome.suggestion.id,
                      dishId: outcome.suggestion.id,
                      isRecipe: false,
                      name: outcome.suggestion.name,
                  };

        if (usedKeys.has(resolved.dishKey)) continue;

        // The model named something that dedup resolved back onto the dish this
        // set is ABOUT. `dish_pairings_not_self` would refuse the row anyway;
        // catching it here keeps the rank sequence contiguous.
        if (resolved.dishKey === mainDishKey) continue;

        usedKeys.add(resolved.dishKey);
        perCourseCount.set(
            courseType,
            (perCourseCount.get(courseType) ?? 0) + 1
        );

        pairings.push({
            courseType,
            dishKey: resolved.dishKey,
            dishId: resolved.dishId,
            isRecipe: resolved.isRecipe,
            name: resolved.name,
            // Within a course, in the order the model produced them. Its own
            // ranking is the only one available — nothing here has been saved
            // by anybody yet, which is precisely what distinguishes a proposal
            // from the evidence layer above it.
            rank: (perCourseCount.get(courseType) ?? 1) - 1,
        });
    }

    // A course endorsed whose dishes were all dropped — or that the model never
    // named one for — KEEPS its endorsement (owner's call, 2026-09-16). The
    // picker draws its row and offers the search field, which is a truer answer
    // than silently un-endorsing a course a cook would serve.
    //
    // Note how often this happens: of the first four dishes warmed, two
    // endorsed a course and produced nothing for it. The prompt tells the model
    // to return fewer dishes rather than reach, and it obeys that AFTER having
    // said the course belongs — so this is the normal shape of a thin answer,
    // not an edge case. Anything here that starts pruning `courses` to match
    // `pairings` is reversing a decision; see docs/menu.md for the two
    // alternatives that were not taken.
    return {
        // A run that did not CHOOSE makes no claim about what the dish wants —
        // it was told what to name. The caller merges on the strength of that,
        // so the stored endorsement survives untouched.
        courses: chooseCourses ? modelCourses : [],
        // Everything this run solicited: what the model endorsed, plus the
        // course the reader pressed. A course asked about and answered with
        // nothing still belongs here, or the next press buys the same silence.
        asked: chooseCourses
            ? [...new Set([...modelCourses, ...targeted])]
            : targeted,
        pairings,
        model: PAIRING_MODEL,
    };
}
