import { borrowMenuTitle } from "./borrow-menu-title";
import { compileBlacklist } from "./blacklist";
import { fetchMenuPairings, type MenuPairing } from "./fetch-menu-pairings";
import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    ComposeRecipeMenuDto,
    ComposeRecipeRequestDto,
    ComposeRecipeResultDto,
    ComposeRecipeProgressDto,
    ComposeRecipeWithdrawnDto,
    GenerateRecipeResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import {
    ADAPTED_FOR_RULE,
    BLACKLIST_RULE,
    FOOD_ONLY_RULE,
} from "../../suggestions/services/constraint-rules";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "../../suggestions/services/naming-rules";
import { persistOrReuseSuggestion } from "../../suggestions/services/persist-or-reuse-suggestion";
import { createSuggestionBatch } from "../../suggestions/services/suggestion-batch";
import {
    COMPONENT_RULE,
    DISH_FORM_RULE,
    TAGS_KEY_RULE,
} from "../../suggestions/services/tagging-rules";
import { DISH_TOTAL_TIME_RULE } from "../../suggestions/services/timing-rules";

import { fetchRecipeMetadata } from "./fetch-recipe-metadata";

/**
 * What to call the whole dinner.
 *
 * Local to compose because compose is the only caller — the same reason the chat
 * tools live under `chat`. It sits apart from `naming-rules.ts` deliberately:
 * those rules name a DISH, and this one contradicts the most important of them.
 *
 * `DISH_NAME_RULE` strips the cuisine out of a dish name because the card prints
 * it as an eyebrow directly above the title. A menu heading has no eyebrow —
 * nothing beside it says where the meal is from — so here the origin is the most
 * useful thing the title can carry. Do not "fix" this to match its sibling.
 */
const MENU_TITLE_RULE = `menu_title — a name for the WHOLE MEAL, alone on the FIRST line as {"menu_title": "..."} and carrying no other keys. Rules:
  - 2 to 4 words. It is drawn as a card heading and as a navigation title, and both truncate.
  - Name the MEAL, never the main dish. The main course's name is printed directly beneath this heading, so repeating it says nothing: "Coq au Vin" is not a menu title.
  - The cuisine, region or occasion IS worth carrying here, unlike in a dish name — nothing else beside this heading gives the meal an origin. "A Sunday in Burgundy", "Trattoria Lunch", "Thai Table", "Bistro Supper".
  - Say what the meal IS; do not praise it. "Autumn Sunday Roast" names a meal, "A Symphony of Autumn Flavours" reviews one.
  - Never claim an occasion the dishes do not support. No "Christmas", "Wedding" or "Birthday" unless these are actually those dishes.
  - No superlatives and no filler: not "Ultimate", "Perfect", "Delicious", "Feast", "Extravaganza", "Experience", "Journey". No exclamation marks, no closing punctuation. Title Case.`;

/**
 * The meal's title, as the model emits it.
 *
 * Tried SECOND, behind the dish schema, and the order is what keeps the two
 * apart in both directions: a dish line cannot satisfy this (nothing else has a
 * `menu_title` key) and a title line cannot satisfy the dish schema (it carries
 * none of the six required fields). Putting this first would let a dish that
 * happened to include a `menu_title` key be swallowed as a title.
 */
const ComposeMenuTitleSchema = z.object({
    menu_title: z.string(),
});

const MENU_TITLE_SCHEMA_INDEX = 1;

/**
 * Long enough for four words, short enough for a navigation bar.
 */
const MENU_TITLE_MAX_LENGTH = 60;

/**
 * The title fit to show, or null to fall back to the main course's name.
 *
 * Sanitises rather than rejects, because this is a nicety riding on an expensive
 * stream: the frame is `parse`d inside the use case's streaming loop, where a
 * throw is caught as a STREAM FAILURE — so a rambling title would abort a
 * composition whose courses had all succeeded, and turn a cosmetic problem into
 * a paid one. Nothing downstream may depend on a title arriving.
 */
const cleanMenuTitle = (raw: string): string | null => {
    const cleaned = raw
        .replace(/\s+/g, " ")
        .trim()
        // Models like to hand a title back already quoted.
        .replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "")
        .trim();

    if (!cleaned) return null;

    // Dropped, not truncated. A heading cut off mid-word is worse than the main
    // course's name, which is what the client falls back to — and the fallback
    // is already the behaviour every menu saved before this shipped has.
    if (cleaned.length > MENU_TITLE_MAX_LENGTH) {
        console.warn(
            `[Compose] Dropped menu title (${cleaned.length} chars): "${cleaned.slice(0, 80)}"`
        );
        return null;
    }

    return cleaned;
};

/**
 * Schema for LLM-generated composition suggestions (JSONL format)
 */
const ComposeRecipeSuggestionSchema = z.object({
    name: z.string(),
    name_alt: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    // Borrowed from the shared schema rather than restated. The parsed object is
    // handed straight to `persistOrReuseSuggestion`, which types it as
    // `GenerateSuggestionResponseDto` — so a hand-written copy here would have to
    // keep the coercion, bounds and the load-bearing optional/catch order in
    // step with that file forever, and nothing would report it drifting.
    total_time_minutes: GenerateSuggestionResponseSchema.shape.total_time_minutes,
    course: z.string(),
    ingredients: z.array(z.string().min(1)),
    tags: z.array(z.string()),
    /** Blacklisted ingredients swapped out — see {@link BLACKLIST_RULE}. */
    adaptedFor: z.array(z.string()).default([]),
});

type ComposeRecipeSuggestion = z.infer<typeof ComposeRecipeSuggestionSchema>;

const SYSTEM_PROMPT = `You are a recipe composition assistant. Generate complementary courses for a given base recipe.

## Rules
- Suggest authentic, real-world recipes that complement the base recipe
- Each recipe MUST be a real dish (not invented, must be authentic), named by the rule under "Output Format" below
- ${FOOD_ONLY_RULE}
  - This applies to PAIRINGS too. A wine or cocktail that would go well with the base recipe is still a drink, and a menu course here is always something eaten.
- Do NOT suggest recipes of excluded course types
- If cuisine matching is requested, suggest recipes from the same cuisine
- If difficulty matching is requested, suggest recipes of similar difficulty

## Who is eating (CRITICAL)
${BLACKLIST_RULE}
  - A menu is one meal, so these apply to EVERY course, not only the ones that would obviously carry them. A dairy blacklist rules out the buttered side as well as the dessert.
  - They are NOT satisfied by the base recipe already complying. The base was picked by the user; these courses are being chosen for them.

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques
- "medium": The standard authentic recipe with its usual techniques
- "hard": Elevated or advanced version with more complex techniques

## Tagging Rules (CRITICAL)
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe: the course type being suggested. The ONLY valid course tags are: appetizer, dessert, main, side. Never omit it, and never invent another (not "starter", "dinner", "entree" or "main course") — a starter is "appetizer".
- ${DISH_FORM_RULE}
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free)

## Ingredients
- MUST be singular
- Include key ingredients that define the dish

## Output Format
Output one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

The FIRST line names the meal as a whole:
- ${MENU_TITLE_RULE}

Every line after it is one recipe, and must include:
- ${DISH_NAME_RULE}
- ${DISH_NAME_ALT_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- ${DISH_TOTAL_TIME_RULE}
- course (the course type)
- ingredients (array of key ingredient strings)
- ${ADAPTED_FOR_RULE}
- ${TAGS_KEY_RULE}`;

/**
 * Which course slots the base recipe already fills, and which of the requested
 * ones are therefore still open.
 *
 * Computed ONCE and handed to both callers. It used to be duplicated verbatim in
 * `buildUserPrompt` and `generateComposeRecipes` — two copies of the rule that
 * decides what the composer may suggest, free to drift into disagreeing about
 * what the user asked for.
 *
 * Matched by EXACT name, not `includes`. The loose form was a false-positive
 * waiting to happen — any tag whose name merely contained a course word counted
 * as that course — and it is the same defect the cuisine lookup below carries a
 * comment about having already fixed. Every caller sends the vocabulary verbatim
 * (`["appetizer", "main", "side", "dessert"]`, see the client's COURSE_ORDER), so
 * exact matching loses nothing.
 */
const splitCourses = (
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    courseTagNames: string[]
): { base: string[]; allowed: string[] } => {
    const base = baseRecipe.tags.filter((tag) =>
        courseTagNames.some(
            (course) => tag.toLowerCase() === course.toLowerCase()
        )
    );

    const allowed = request.courseTypes.filter(
        (course) =>
            !base.some(
                (baseCourse) =>
                    baseCourse.toLowerCase() === course.toLowerCase()
            )
    );

    return { base, allowed };
};

/**
 * How many dishes a course wants. `courseCounts` when the caller said so,
 * otherwise the flat `maxSuggestions` it replaced.
 */
const countFor = (course: string, request: ComposeRecipeRequestDto): number =>
    request.courseCounts[course] ?? request.maxSuggestions;

const buildUserPrompt = (
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    courses: { base: string[]; allowed: string[] },
    cuisineTagNames: string[],
    /** What is still to be generated, per slot, after retrieval filled what it could. */
    remaining: Map<string, number>,
    /** What retrieval already put on the plate. */
    retrieved: Array<{ courseType: string; name: string }>
): string => {
    const baseCourses = courses.base;
    const allowedCourses = courses.allowed;

    // Matched against the actual cuisine vocabulary. This used to take the first
    // tag that was neither a course nor "dish", which also matches DIETARY tags —
    // a vegan Italian dish could send the model "Cuisine: vegan". A recipe may
    // now carry two cuisines (a genuine fusion dish), and both are worth sending:
    // the complementary course should fit the whole dish, not half its heritage.
    const cuisineTags = baseRecipe.tags.filter((tag) =>
        cuisineTagNames.some(
            (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
        )
    );

    const parts = [
        `Base Recipe: ${baseRecipe.name}`,
        `Description: ${baseRecipe.description}`,
        `Key Ingredients: ${baseRecipe.ingredients
            .slice(0, 5)
            .map((i) => i.name)
            .join(", ")}`,
    ];

    if (request.matchCuisine && cuisineTags.length > 0) {
        parts.push(`Cuisine: ${cuisineTags.join(", ")}`);
    }

    if (request.matchDifficulty) {
        parts.push(`Difficulty: ${baseRecipe.difficulty}`);
    }

    // The blacklist is per-INGREDIENT and adapts the dish; the restrictions are
    // absolute and change WHICH dish. Both are listed before the courses so the
    // model reads them as constraints on the whole menu rather than as notes on
    // the last course named.
    if (request.blacklist.length > 0) {
        parts.push(`Blacklist: ${request.blacklist.join(", ")}`);
    }

    if (request.dietaryRestrictions.length > 0) {
        parts.push(
            `Dietary Restrictions: ${request.dietaryRestrictions.join(", ")}`
        );
    }

    // One line per course carrying its own count, rather than one global "N per
    // course type". The caller's wants are per-course — two sides and one
    // dessert — and a single number told the model to produce two of everything.
    parts.push(
        [
            `\nRequested Courses:`,
            ...allowedCourses
                // Only the slots retrieval could not fill. A slot asked for
                // again would be generated, reviewed, embedded, persisted and
                // then dropped by the counter below — paid for and discarded.
                .filter((course) => (remaining.get(course) ?? 0) > 0)
                .map((course) => {
                    const count = remaining.get(course) ?? 0;
                    return `- ${course}: ${count} dish${count > 1 ? "es" : ""}`;
                }),
        ].join("\n")
    );

    // Deliberately NOT folded into `exclude` below, which renders as "do NOT
    // suggest these or a variant of them". "The user rejected this" and "this is
    // already on the plate" are different instructions, and merging them costs
    // both halves of what the single LLM call is for: the model picks a dessert
    // without knowing what the appetizer is, so the courses stop being one meal,
    // and `MENU_TITLE_RULE` names a fragment instead of the dinner.
    if (retrieved.length > 0) {
        parts.push(
            [
                `\nAlready on this menu — these courses are settled. Choose the remaining ones to go WITH them, and do not repeat them:`,
                ...retrieved.map(
                    (dish) => `- ${dish.courseType}: ${dish.name}`
                ),
            ].join("\n")
        );
    }

    if (baseCourses.length > 0) {
        parts.push(`Excluded Courses: ${baseCourses.join(", ")}`);
    }

    if (request.exclude.length > 0) {
        parts.push(
            `\nAlready offered — do NOT suggest these or a variant of them: ${request.exclude.join(", ")}`
        );
    }

    parts.push(`\nGenerate authentic complementary dishes.`);

    return parts.join("\n");
};

/**
 * Generate composition suggestions for complementary courses.
 * Uses LLM to suggest recipes, then searches for existing recipes or creates new suggestions.
 *
 * @param baseRecipe The recipe to compose with
 * @param request Composition parameters (course types, matching preferences, etc.)
 * @param provider Overrides `LLM_PROVIDER` for this call, to A/B the two
 * @yields Progress updates and recipe results
 */
export async function* generateComposeRecipes(
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    provider?: LlmProvider
): AsyncGenerator<
    | ComposeRecipeResultDto
    | ComposeRecipeProgressDto
    | ComposeRecipeMenuDto
    | ComposeRecipeWithdrawnDto
> {
    // Fetch metadata to get course tags from database
    const metadata = await fetchRecipeMetadata();
    const courseTagNames = metadata.tags
        .filter((tag) => tag.type === "course")
        .map((tag) => tag.name);
    const cuisineTagNames = metadata.tags
        .filter((tag) => tag.type === "cuisine")
        .map((tag) => tag.name);

    // Validate that we have allowed courses. The same split is handed to
    // `buildUserPrompt` below rather than recomputed there.
    const courses = splitCourses(baseRecipe, request, courseTagNames);
    const allowedCourses = courses.allowed;

    if (allowedCourses.length === 0) {
        throw new Error(
            "All requested course types are already present in base recipe"
        );
    }

    // Yield initial progress
    yield {
        type: "progress",
        stage: "generating",
        courseType: allowedCourses.join(", "),
        // Emitted before retrieval has run, so it cannot yet say how much of
        // this will be generated rather than looked up — and a composition
        // filled entirely from existing menus generates nothing at all. Worded
        // for what is true at this point. (No client reads `progress`; this is
        // for whoever reads the SSE log next.)
        message: `Composing ${allowedCourses.length} course type(s)`,
    };

    const excluded = new Set(
        request.exclude.map((name) => name.toLowerCase().trim())
    );

    /** Is this name one the caller has already been offered? */
    const isExcluded = (...names: (string | null | undefined)[]) =>
        names.some((name) => !!name && excluded.has(name.toLowerCase().trim()));

    /**
     * Does this dish contain something the caller will not eat?
     *
     * Null when the caller sent no blacklist, so both reuse paths below can
     * branch on "there is nothing to check" once.
     */
    const blacklistMatcher = compileBlacklist(request.blacklist);

    /**
     * The requested slot this dish fills, or null if the model named one that
     * was not asked for.
     *
     * The `course` field is free text off the LLM — the JSONL schema types it
     * `z.string()` and nothing downstream constrained it — so echoing it back as
     * `courseType` shipped the model's spelling to a client that buckets on it.
     * "Side", "side dish" or "entree" all parse, all validate, and all land in a
     * bucket the client renders nothing for: the dish is generated, reviewed,
     * embedded, persisted, streamed, and then dropped on the floor. Clamping to
     * the vocabulary is what makes the field mean what its schema says it means.
     */
    const resolveCourse = (course: string): string | null =>
        allowedCourses.find(
            (allowed) => allowed.toLowerCase() === course.trim().toLowerCase()
        ) ??
        // A single-course request has only one honest answer, so a misspelling
        // costs nothing to absorb. With several open slots there is no way to
        // tell which was meant, and guessing puts a dessert under "Side".
        (allowedCourses.length === 1 ? allowedCourses[0] : null);

    /**
     * What people have already put on a plate with this dish.
     *
     * Retrieval runs BEFORE the model is asked anything, because a pairing
     * somebody actually saved is a better answer than an invented one and costs
     * no tokens. What it cannot fill falls through to the single LLM call below,
     * which is the whole of the rule: prefer an existing combination, generate
     * only what the corpus has not got.
     *
     * `COMPOSE_RETRIEVAL=off` restores the pre-retrieval behaviour exactly. This
     * is the only paid route in the product and the request DTO cannot carry a
     * flag — its JSON is the client's cache key and its background-job id, so
     * one extra field invalidates every cached menu. A scoped switch, to be
     * DELETED once this has run a week (see CLAUDE.md on feature flags).
     */
    const retrievalEnabled =
        (process.env.COMPOSE_RETRIEVAL ?? "on").toLowerCase() !== "off";

    /** What each slot still wants once retrieval has had its turn. */
    const remaining = new Map(
        allowedCourses.map((course) => [course, countFor(course, request)])
    );

    /**
     * Every dish this composition has committed to, by `dish_key` — the identity
     * `save_menu` computes, NOT the row id.
     *
     * The distinction is the whole point: the same dish is a suggestion row in
     * one menu and a promoted recipe row in another, so comparing ids would let
     * retrieval take it for the side and the model take it again for the
     * appetizer.
     */
    const usedKeys = new Set<string>();

    const retrieved: MenuPairing[] = [];

    if (retrievalEnabled) {
        const pairings = await fetchMenuPairings({
            recipeId: baseRecipe.id,
            courseTypes: allowedCourses,
            // Slack over what is wanted: the blacklist re-check and the
            // cross-slot dedup below can still drop rows SQL kept, and a slot
            // left short here is a slot that pays for an LLM call.
            perCourse:
                Math.max(...allowedCourses.map((c) => countFor(c, request)), 1) +
                2,
            exclude: request.exclude,
            excludeKeys: [],
            blacklist: request.blacklist,
            dietaryRestrictions: request.dietaryRestrictions,
            // Orders, never narrows — `p_difficulty` is a tiebreak in the SQL.
            difficulty: request.matchDifficulty ? baseRecipe.difficulty : null,
        });

        for (const pairing of pairings) {
            if ((remaining.get(pairing.courseType) ?? 0) <= 0) continue;
            if (usedKeys.has(pairing.dishKey)) continue;

            // Belt to the SQL filter's braces. `resolveIngredientIds` DROPS a
            // blacklist name it cannot resolve, so the id filter is silently
            // weaker than what the user actually typed; this matcher
            // canonicalises the raw string and has no resolution step to fail.
            // The rule CLAUDE.md states for `promote`'s reuse shortcuts applies
            // here for the same reason — a retrieved dish was chosen by nobody
            // who knew the blacklist.
            if (
                blacklistMatcher &&
                blacklistMatcher(pairing.ingredients.map((i) => i.name)).length >
                    0
            ) {
                continue;
            }

            usedKeys.add(pairing.dishKey);
            remaining.set(
                pairing.courseType,
                (remaining.get(pairing.courseType) ?? 0) - 1
            );
            retrieved.push(pairing);
        }
    }

    // NOTE what does not happen above: a candidate dropped for `exclude`, the
    // blacklist, a diet or an already-used key emits NOTHING. A `withdrawn`
    // frame decrements the client's `outstanding`, which draws "Nothing to pair
    // here" in that slot — and the model is still about to fill it, so the card
    // would then change its mind. The slot has not been given up on.

    const shortfall = [...remaining.values()].reduce(
        (total, count) => total + Math.max(count, 0),
        0
    );

    // The title, when there is no LLM call to produce one. Emitted BEFORE the
    // courses so the client draws its heading and its cards in one pass, the
    // same order the generated path produces them in.
    if (shortfall === 0 && retrieved.length > 0) {
        const borrowed = await borrowMenuTitle(
            retrieved.map((pairing) => pairing.menuIds),
            retrieved.length + 1
        );

        const title = borrowed ? cleanMenuTitle(borrowed) : null;

        if (title) {
            yield { type: "menu", title };
        }
    }

    for (const pairing of retrieved) {
        yield pairing.isRecipe
            ? {
                  type: "result",
                  source: "existing",
                  courseType: pairing.courseType,
                  id: pairing.id,
                  name: pairing.name,
                  nameEn: pairing.nameEn,
                  description: pairing.description,
                  shortDescription: pairing.shortDescription,
                  difficulty: pairing.difficulty,
                  totalTimeMinutes: pairing.totalTimeMinutes,
                  ingredients: pairing.ingredients,
                  tags: pairing.tags,
                  image: pairing.image,
              }
            : {
                  // A course saved before anybody generated it is still a
                  // suggestion row, and that is most of what a young corpus
                  // holds. Emitted exactly as the LLM path emits one, so the
                  // client needs no new branch.
                  type: "result",
                  source: "suggestion",
                  courseType: pairing.courseType,
                  id: pairing.id,
                  name: pairing.name,
                  nameEn: pairing.nameEn,
                  description: pairing.description,
                  difficulty: pairing.difficulty,
                  totalTimeMinutes: pairing.totalTimeMinutes,
                  ingredients: pairing.ingredients,
                  tags: pairing.tags,
              };
    }

    if (shortfall === 0) {
        console.log(
            `[Compose] ${retrieved.length} retrieved, 0 generated — no model call`
        );

        yield {
            type: "progress",
            stage: "complete",
            courseType: "",
            message: "Composition complete",
        };

        return;
    }

    console.log(
        `[Compose] ${retrieved.length} retrieved, ${shortfall} to generate`
    );

    // Coordinates dedup between the courses of THIS request. Without it the two
    // sides of one menu could resolve to the same dish: the loop awaits
    // sequentially, so by the time the second runs the first is already in the
    // database and the DB layers *reuse* it — yielding a second result with an
    // identical id rather than dropping it. The batch catches that in memory,
    // one step earlier, and returns `dropped/duplicate` instead.
    const batch = createSuggestionBatch();

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "recipe.compose",
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(
            baseRecipe,
            request,
            courses,
            cuisineTagNames,
            remaining,
            retrieved
        ),
        provider,
    });

    // Only the first survives. The rule asks for one title on the first line;
    // a model that repeats itself further down must not be able to rename a
    // meal the client has already drawn a heading for.
    let titled = false;

    // Process JSONL stream with validation
    for await (const { parsed, schemaIndex } of processJsonlStream(stream, [
        ComposeRecipeSuggestionSchema,
        ComposeMenuTitleSchema,
    ])) {
        if (schemaIndex === MENU_TITLE_SCHEMA_INDEX) {
            const title = cleanMenuTitle(
                (parsed as z.infer<typeof ComposeMenuTitleSchema>).menu_title
            );

            if (title && !titled) {
                titled = true;
                yield { type: "menu", title };
            }

            continue;
        }

        const suggestion = parsed as ComposeRecipeSuggestion;

        const courseType = resolveCourse(suggestion.course);

        if (!courseType) {
            // Dropped WITHOUT a withdrawal frame, deliberately. A withdrawal
            // names the slot it releases, and this dish belongs to none that
            // were asked for — sending the model's own string would land in a
            // bucket the client reads nothing from, and picking a requested slot
            // for it would cancel a placeholder that another dish is still on
            // its way to fill. The slot it should have filled is covered anyway:
            // it stays outstanding until the stream ends and is then reported
            // short.
            console.warn(
                `[Compose] Dropped "${suggestion.name}" — course "${suggestion.course}" is not one of ${allowedCourses.join(", ")}`
            );
            continue;
        }

        // The slot is already full — retrieval filled it, or an earlier line
        // did. Dropped WITHOUT a frame and BEFORE `persistOrReuseSuggestion`,
        // which is where the saving is: the review alone is roughly three
        // quarters of a batch's tokens, and this dish was never going to be
        // shown. No withdrawal, because the slot is not short — it is
        // over-served, and "withdrawn" would tell the client the opposite.
        if ((remaining.get(courseType) ?? 0) <= 0) {
            console.warn(
                `[Compose] Dropped "${suggestion.name}" — ${courseType} is already filled`
            );
            continue;
        }

        // The prompt asks for these to be avoided; enforce it too, so a model
        // that ignores the instruction can't hand a client back the dish it
        // explicitly asked to move on from.
        if (isExcluded(suggestion.name, suggestion.name_alt)) {
            yield {
                type: "withdrawn",
                courseType,
                name: suggestion.name,
                reason: "excluded",
            };
            continue;
        }

        // Yield search progress
        yield {
            type: "progress",
            stage: "searching",
            courseType,
            message: `Searching for "${suggestion.name}"`,
        };

        // Identity is decided exactly as it is for the discovery feed. This used
        // to run its own weaker chain — a vector search on the BARE DISH NAME,
        // then an exact-name lookup among suggestions. Both were broken:
        //
        //  - `recipes.embedding` holds a dish SIGNATURE ("name | tags |
        //    ingredients", see persist-recipe), so querying it with a bare-name
        //    vector compares two different kinds of text. Real matches scored
        //    below the caller's threshold and the dish was regenerated, which is
        //    why a course whose recipe plainly existed was never reused.
        //  - There was no exact-name layer over `recipes` at all, so not even a
        //    literal name match could rescue it.
        //
        // `persistOrReuseSuggestion` already does the whole thing: recipes by
        // exact name then signature similarity, suggestions by exact name then
        // the calibrated band with LLM adjudication, plus the authenticity gate.
        const outcome = await persistOrReuseSuggestion(
            suggestion,
            {
            // The cuisine tag the model gave this dish, matched against the
            // actual cuisine vocabulary — the same way `buildUserPrompt` above
            // resolves the BASE recipe's cuisine, and for the same reason.
            //
            // This used to take the first tag that was neither a course nor
            // "dish", which also matches DIETARY tags: a vegan Italian dish
            // handed dedup "vegan" as its cuisine. That is worse than handing it
            // nothing, because cuisine is an identity signal — two dishes agreeing
            // on "vegan" look related when they are not.
            //
            // It also quietly depended on the `dish` component marker existing to
            // exclude it. Matching positively removes that coupling, which is
            // what lets the marker be dropped.
            //
            // A cuisine the model invents in THIS batch is not in the snapshot
            // taken at the top of this function, so it resolves to undefined
            // rather than being caught. That is the right trade: `cuisine` is an
            // optional hint, and no hint beats a wrong one. `matchTags` still
            // creates the tag during persistence, so the next call sees it.
                cuisine: suggestion.tags.find((tag) =>
                    cuisineTagNames.some(
                        (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
                    )
                ),
            },
            { batch }
        );

        if (outcome.kind === "dropped") {
            console.warn(
                `[Compose] Dropped "${suggestion.name}" (${outcome.reason})`
            );
            yield {
                type: "withdrawn",
                courseType,
                name: suggestion.name,
                reason: outcome.reason,
            };
            continue;
        }

        if (outcome.kind === "existing_recipe") {
            const recipe = outcome.recipe;

            // The review can rename a dish and dedup can resolve it onto a
            // catalogue row under a name the caller has already seen — neither of
            // which the pre-flight check above could know. Re-testing the FINAL
            // name is what makes `exclude` mean "do not show me this again"
            // rather than "do not generate this string".
            if (isExcluded(recipe.name, recipe.nameEn)) {
                yield {
                    type: "withdrawn",
                    courseType,
                    name: recipe.name,
                    reason: "excluded",
                };
                continue;
            }

            // The identity `save_menu` computes, so a dish retrieved for one
            // slot cannot be generated into another. The model names it
            // differently, dedup resolves that name onto the row already on the
            // plate, and only comparing keys catches it.
            const recipeKey = recipe.sourceSuggestionId ?? recipe.id;

            if (usedKeys.has(recipeKey)) {
                yield {
                    type: "withdrawn",
                    courseType,
                    name: recipe.name,
                    reason: "duplicate",
                };
                continue;
            }

            // This branch has never checked the blacklist, which is the hole
            // CLAUDE.md describes for `promote`'s reuse shortcuts: the row was
            // written for somebody ELSE's request, so the dish being right stops
            // implying the recipe is usable. Retrieval checks; two reuse paths
            // in one file disagreeing would be worse than either.
            if (
                blacklistMatcher &&
                blacklistMatcher(recipe.ingredients.map((i) => i.name)).length >
                    0
            ) {
                yield {
                    type: "withdrawn",
                    courseType,
                    name: recipe.name,
                    // No `blacklisted` member on the closed reason enum, and
                    // adding one is a schema change that has to reach the
                    // client's pinned tarball. `invalid` is the least-wrong
                    // answer until the next rebuild carries a proper one.
                    reason: "invalid",
                };
                continue;
            }

            usedKeys.add(recipeKey);
            remaining.set(courseType, (remaining.get(courseType) ?? 0) - 1);

            yield {
                type: "result",
                source: "existing",
                // The slot ASKED for, not the slot this catalogue row happens to
                // be tagged with — those disagree often, and the caller is
                // filling a menu, not reading the row's own taxonomy.
                courseType,
                id: recipe.id,
                name: recipe.name,
                nameEn: recipe.nameEn,
                description: recipe.description,
                shortDescription: recipe.shortDescription,
                difficulty: recipe.difficulty,
                totalTimeMinutes: recipe.totalTimeMinutes,
                ingredients: recipe.ingredients,
                tags: recipe.tags,
                image: recipe.image,
            };
            continue;
        }

        const reused = outcome.suggestion;

        if (isExcluded(reused.name, reused.nameEn)) {
            yield {
                type: "withdrawn",
                courseType,
                name: reused.name,
                reason: "excluded",
            };
            continue;
        }

        // A suggestion IS its own dish key — it has no recipe to normalise
        // through yet, which is exactly what `save_menu` records for it.
        if (usedKeys.has(reused.id)) {
            yield {
                type: "withdrawn",
                courseType,
                name: reused.name,
                reason: "duplicate",
            };
            continue;
        }

        if (
            blacklistMatcher &&
            blacklistMatcher(reused.ingredients.map((i) => i.name)).length > 0
        ) {
            yield {
                type: "withdrawn",
                courseType,
                name: reused.name,
                reason: "invalid",
            };
            continue;
        }

        usedKeys.add(reused.id);
        remaining.set(courseType, (remaining.get(courseType) ?? 0) - 1);

        yield {
            type: "result",
            source: "suggestion",
            courseType,
            id: reused.id,
            name: reused.name,
            nameEn: reused.nameEn,
            description: reused.description,
            difficulty: reused.difficulty,
            totalTimeMinutes: reused.totalTimeMinutes,
            ingredients: reused.ingredients,
            tags: reused.tags,
        };
    }

    // Yield completion
    yield {
        type: "progress",
        stage: "complete",
        courseType: "",
        message: "Composition complete",
    };
}
