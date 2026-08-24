import { z } from "zod/v4";

import {
    searchRecipeSuggestions,
    type SearchRecipeSuggestionsOptions,
} from "../../recipes/services/search-recipe-suggestions";

/**
 * The extra courses a menu can ask for.
 *
 * `main` is deliberately absent, and its absence is the whole model: a menu is
 * built AROUND a main, so the main is the seed rather than one of the slots
 * being requested. Offering it here would let the model ask for a second one.
 *
 * The four-slot vocabulary itself is closed and seeded by `002_tags.sql`; this
 * is that list minus the seed. The client's `COURSE_SLOTS` holds the full four
 * and its course picker filters the same way, so the two agree about what is
 * still open.
 */
export const MENU_COURSE_SLOTS = ["appetizer", "side", "dessert"] as const;

export type MenuCourseSlot = (typeof MENU_COURSE_SLOTS)[number];

export interface PlanMenuToolContext {
    onStage?: SearchRecipeSuggestionsOptions["onStage"];
    onMetric?: SearchRecipeSuggestionsOptions["onMetric"];
    speculativeEmbedding?: SearchRecipeSuggestionsOptions["speculativeEmbedding"];
}

export const PlanMenuInputSchema = z.object({
    title: z
        .string()
        .describe(
            "What to call the menu, as a short noun phrase the user would recognise from their own request: 'A traditional Italian menu', 'A vegetarian summer dinner', 'A Thai feast'. No colon, no explanation after it, and never longer than about six words."
        ),
    mainQuery: z
        .string()
        .describe(
            "What the MAIN COURSE should be, as a search query. A menu is built around one main and this is how it is found, so it must describe a dish rather than the occasion: 'Italian pasta', 'roast lamb', 'Thai green curry'. Take it from whatever the user said about the food — 'a traditional Italian menu, pasta based' is 'Italian pasta'."
        ),
    mainDish: z
        .string()
        .optional()
        .describe(
            "Set ONLY when the user named the main dish outright ('a menu around osso buco' -> 'Osso Buco'). It pins the search to exactly that dish, so setting it on a description ('pasta based') would block every good answer."
        ),
    courses: z
        .array(z.enum(MENU_COURSE_SLOTS))
        .optional()
        .describe(
            "The courses to serve ALONGSIDE the main, in the order they are eaten, set ONLY when the user said which ones they want — 'a french menu with a side and dessert' is ['side', 'dessert'], 'a three course italian menu' is ['appetizer', 'dessert']. Never include 'main': the main is what the menu is built around, not one of these. OMIT it entirely when they did not say. Do not guess and do not fill it in with the usual shape of a menu — leaving it unset is what makes the app ask them, and being asked once is better than being handed a menu with a course they did not want."
        ),
});

export type PlanMenuInput = z.infer<typeof PlanMenuInputSchema>;

/**
 * The menu as it goes over the wire — one card, not a list of dishes.
 *
 * Nothing here is generated. A menu costs a paid stream per course, so this
 * tool stops at the point where the user can see what they would be asking for
 * and decide: it resolves the MAIN (one search, usually a catalogue hit) and
 * names the courses. The composing happens on the menu screen, behind a second
 * deliberate tap.
 */
export interface MenuPlan {
    title: string;
    /**
     * The courses the user asked for — and EMPTY when they did not say.
     *
     * Empty is not a failure, it is the question: the card turns into an
     * inquiry and asks which courses they want before anything is composed. So
     * the model is told to omit this rather than guess, because a guess would
     * hand someone a menu with a course they did not want and no moment at
     * which they were asked.
     *
     * It can also empty out here even when the model DID answer, if every slot
     * it named is one the main already fills — which is the same situation and
     * gets the same question.
     */
    courses: MenuCourseSlot[];
    /**
     * Every slot that can be asked for — the closed vocabulary minus whatever
     * the main itself already fills.
     *
     * This is what the inquiry offers when `courses` is empty. A menu seeded
     * with a dessert must not offer a second one, and the compose endpoint
     * subtracts the seed's own slots server-side and fails the stream when
     * nothing is left, so the filtering has to agree.
     */
    availableCourses: MenuCourseSlot[];
    /**
     * The dish the menu is built around, or null if the search found nothing.
     *
     * One object rather than a spray of `main*` fields, because the two ids are
     * mutually exclusive and the difference decides the whole flow — see
     * {@link MenuMain}.
     */
    main: MenuMain | null;
    /**
     * What to search the menu screen for when there is no main at all.
     *
     * The fallback is a real outcome rather than a failure: the user still gets
     * a card, still lands in the menu flow, and picks the main themselves from
     * results for the thing they actually asked for.
     */
    query: string;
}

/**
 * The main course, in one of two states.
 *
 * **A menu can only be composed around a RECIPE.** Every step of the compose
 * flow is keyed on a real recipe id — `useRecipe` for the seed, then
 * `POST /recipes/:id/compose` — so a suggestion is not yet usable as a main.
 *
 * That is not a reason to hide it. A suggestion is a real dish the user asked
 * for; it simply has not been written yet. The client sends them through
 * generation first and carries the menu on the other side of it, which is the
 * same route the compose flow's own search already takes for a suggestion (see
 * `GenerateContinuation` in the app).
 *
 * Exactly one of `recipeId` and `suggestionId` is set.
 */
export interface MenuMain {
    name: string;
    /** Set when the dish is already a catalogue recipe: compose can start. */
    recipeId: string | null;
    /** Set when it still has to be generated before a menu can be built on it. */
    suggestionId: string | null;
    /** Hero illustration; only a generated recipe has one. */
    image: string | null;
    /**
     * Carried so the generation screen can open looking like the card the user
     * tapped rather than a page of skeletons — the same prefill every other
     * suggestion tap passes along.
     */
    difficulty: string | null;
    tags: string[];
}

/** Course slots the seed itself already fills, which must not be asked for again. */
function filledSlots(tags: Array<{ name: string }>): Set<string> {
    return new Set(tags.map((tag) => tag.name.toLowerCase()));
}

export async function planMenuHandler(
    input: PlanMenuInput,
    context: PlanMenuToolContext = {}
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const result = await searchRecipeSuggestions(
        {
            query: input.mainQuery,
            dish: input.mainDish,
            // One main. A menu has exactly one thing it is built around, and
            // asking for more would spend a generation on dishes nothing shows.
            maxResults: 1,
        },
        {
            onStage: context.onStage,
            onMetric: context.onMetric,
            speculativeEmbedding: context.speculativeEmbedding,
        }
    );

    const found = result.suggestions[0];

    // Only a real recipe can seed the compose flow; a suggestion has to be
    // generated on the way there. See `MenuMain`.
    const isRecipe = found?.source === "existing_recipe";
    const filled = found ? filledSlots(found.tags) : new Set<string>();

    const main: MenuMain | null = found
        ? {
              name: found.name,
              recipeId: isRecipe ? (found.id ?? null) : null,
              suggestionId: isRecipe ? null : (found.id ?? null),
              image: found.image ?? null,
              difficulty: found.difficulty ?? null,
              tags: found.tags.map((tag) => tag.name),
          }
        : null;

    const availableCourses = MENU_COURSE_SLOTS.filter(
        (slot) => !filled.has(slot)
    );

    // Bound once so the narrowing survives into the callback below.
    const requested = input.courses;

    const menu: MenuPlan = {
        title: input.title,
        // Filtered against what is actually on offer, so the card never arrives
        // holding a course it cannot show a chip for. An unanswered `courses`
        // stays empty, which is what turns the card into the question.
        courses: requested
            ? availableCourses.filter((slot) => requested.includes(slot))
            : [],
        availableCourses,
        main,
        query: input.mainQuery,
    };

    return {
        content: [{ type: "text", text: JSON.stringify({ menu }, null, 2) }],
    };
}

export const planMenuTool = {
    name: "PLAN_MENU",
    definition: {
        title: "Plan a Menu",
        description:
            "Plan a multi-course MENU — several dishes eaten together as one meal. Use this instead of GET_RECIPE_SUGGESTIONS whenever the user asks for a menu, a dinner party, a feast, a spread, a three-course meal, or anything else that is several courses rather than one dish. It finds the main course and names the courses to serve with it; it does not write the dishes, which happens later on the menu screen.",
        inputSchema: PlanMenuInputSchema,
        outputSchema: z.object({
            menu: z.object({
                title: z.string(),
                courses: z.array(z.enum(MENU_COURSE_SLOTS)),
                availableCourses: z.array(z.enum(MENU_COURSE_SLOTS)),
                main: z
                    .object({
                        name: z.string(),
                        recipeId: z.string().nullable(),
                        suggestionId: z.string().nullable(),
                        image: z.string().nullable(),
                        difficulty: z.string().nullable(),
                        tags: z.array(z.string()),
                    })
                    .nullable(),
                query: z.string(),
            }),
        }),
    },
    handler: planMenuHandler,
};
