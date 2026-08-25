import type { ToolCall } from "@fridgeezy/schemas";

/**
 * The routing model's arguments, read defensively.
 *
 * They arrive as a JSON string the model wrote, so nothing here is guaranteed —
 * every field is checked for the type it is used at rather than asserted.
 */
export interface RoutedSearch {
    query?: string;
    dish?: string;
    component?: string;
    ingredients?: string[];
    /** Dish names the search must not return. Read by the routing eval. */
    exclude?: string[];
    /** Set when the turn was routed to `PLAN_MENU` rather than to a dish search. */
    menuTitle?: string;
}

export function readRoutedSearch(toolCalls: ToolCall[]): RoutedSearch {
    const call = toolCalls.find(
        (candidate) =>
            candidate.function.name === "GET_RECIPE_SUGGESTIONS" ||
            candidate.function.name === "PLAN_MENU"
    );

    if (!call) return {};

    try {
        const parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;

        // A menu turn names itself and searches under `mainQuery`; a dish turn
        // uses `query`. Read both here so the opening line has something true to
        // say either way.
        if (call.function.name === "PLAN_MENU") {
            return {
                menuTitle:
                    typeof parsed.title === "string" ? parsed.title : undefined,
                query:
                    typeof parsed.mainQuery === "string"
                        ? parsed.mainQuery
                        : undefined,
                dish:
                    typeof parsed.mainDish === "string"
                        ? parsed.mainDish
                        : undefined,
            };
        }

        return {
            query: typeof parsed.query === "string" ? parsed.query : undefined,
            dish: typeof parsed.dish === "string" ? parsed.dish : undefined,
            component:
                typeof parsed.component === "string" ? parsed.component : undefined,
            ingredients: Array.isArray(parsed.ingredients)
                ? parsed.ingredients.filter(
                      (item): item is string => typeof item === "string"
                  )
                : undefined,
            exclude: Array.isArray(parsed.exclude)
                ? parsed.exclude.filter(
                      (item): item is string => typeof item === "string"
                  )
                : undefined,
        };
    } catch {
        return {};
    }
}

/** "a, b and c" — an Oxford-comma-free list, because it is read as speech. */
function listPhrase(items: string[]): string {
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;

    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The opening line of the reply, written HERE rather than by a model.
 *
 * ## It replaces a whole round trip that could not say anything
 *
 * There used to be a second, tool-less model call whose only job was to produce
 * a sentence while the search ran — and whose own prompt forbade it from naming
 * or describing anything, because the results did not exist yet. So the app was
 * paying a full round trip, and about a second of the user's time, for a
 * sentence that was contentless by construction.
 *
 * By the time this runs the routing call has already returned, so the dish the
 * user asked for is known. That makes the templated line strictly MORE specific
 * than the generated one it replaces — "Let me look up Carbonara for you"
 * against "Sure, let me find something for you" — while arriving the instant
 * routing lands instead of a round trip later.
 *
 * ## It goes out as reply text, not as a new kind of frame
 *
 * It is emitted as `content` deltas, which is exactly what the acknowledgement
 * was. Nothing on the client has to learn anything, and a build that predates
 * every other change here still sees a first line followed by `\n\n` and the
 * summary — the same shape it has always rendered.
 *
 * ## No indefinite articles
 *
 * Every phrasing here is deliberately article-free. Dish names are model output
 * and can begin with any letter, so "a Apple Strudel" is one interpolation away
 * at all times, and there is no reason to take the risk for a word the sentence
 * does not need.
 */
export function buildIntentLine(routed: RoutedSearch): string {
    if (routed.menuTitle) {
        // Lowercased because it is being dropped into the middle of a sentence
        // and the model writes it as a title ("A traditional Italian menu").
        // Only the first character — "Italian" must stay capitalised.
        const title =
            routed.menuTitle.charAt(0).toLowerCase() + routed.menuTitle.slice(1);

        return `Let me put together ${title}.`;
    }

    if (routed.dish) {
        return `Let me look up ${routed.dish} for you.`;
    }

    if (routed.component) {
        return `Let me find the right ${routed.component}.`;
    }

    if (routed.ingredients?.length) {
        return `Let me see what you can make with ${listPhrase(routed.ingredients)}.`;
    }

    if (routed.query) {
        return `Let me find you something for ${routed.query}.`;
    }

    return "Let me have a look.";
}

/**
 * What a turn that found nothing is ABOUT, and which PREPOSITION it takes.
 *
 * The two are one decision. A named dish is a thing the catalogue does not
 * hold — "no established dish CALLED Salsify Gratin" — while an ingredient is
 * something nothing could be built out of — "no established dish BUILT AROUND
 * salsify". One phrasing for both gets the named case exactly backwards, and it
 * is the case where the reader is most likely to be right and us wrong.
 */
function subjectOf(
    routed: RoutedSearch
): { lead: string; subject: string } | null {
    if (routed.dish) return { lead: "called", subject: routed.dish };
    if (routed.component) {
        return { lead: "built around", subject: routed.component };
    }
    if (routed.ingredients?.length) {
        return { lead: "built around", subject: listPhrase(routed.ingredients) };
    }

    if (routed.query) {
        // The raw query is the last resort and it is the one that reads badly
        // interpolated — it is a whole request ("brussel sprouts recipe"), not a
        // noun. Trimming the request words off leaves the subject behind.
        const trimmed = routed.query
            .replace(/\b(a |an |some |the )/gi, "")
            .replace(/\b(recipes?|dishes?|ideas?|something|anything)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        return { lead: "built around", subject: trimmed || routed.query };
    }

    return null;
}

/**
 * What the assistant says when the turn genuinely has nothing to offer.
 *
 * ## It is a real answer, and that is the whole point of it
 *
 * Until this existed the two cases below reached the reader as "Something went
 * wrong. The reply stopped before it finished." with a Regenerate button —
 * because the client's only test was "the tool was invoked and no card came
 * back", which is equally true of a crash. Regenerating re-ran the identical
 * request, so the four attempts measured on 2026-08-24 produced four
 * generations, four notability drops and four identical toasts. The server knew
 * the answer every time and had no way to say it.
 *
 * Written here rather than by a model, for the reason {@link buildIntentLine}
 * is: the summary call is skipped on this path (there is nothing to summarise),
 * and a turn that has to admit a limit should not have its phrasing decided
 * fresh each time. It goes out as `content` deltas, so a client that has never
 * heard of the `unsatisfied` frame still reads a complete, true reply.
 *
 * Both endings name a next move. "There is no dish" is only a dead end if the
 * reader is not told which way out is open.
 */
export function buildUnsatisfiedLine(
    reason: "no_known_dish" | "not_food",
    routed: RoutedSearch
): string {
    if (reason === "not_food") {
        return "That is a drink rather than a dish, and Fridgeezy only holds food — so there is nothing here for me to write up. Ask me for something to eat and I will find it.";
    }

    const about = subjectOf(routed);

    if (!about) {
        return "I could not find an established dish for that — everything I came up with was a plate of food rather than a dish anyone asks for by name. Try naming a dish, or give me an ingredient or two to work with.";
    }

    // A named dish that is not in the catalogue is a different sentence from an
    // ingredient nothing can be built from, and so is the way out of each.
    return about.lead === "called"
        ? `I could not find an established dish called ${about.subject}, and nothing I wrote for it was a dish people ask for by name. Check the spelling, or describe what is in it and I will look again.`
        : `I could not find an established dish built around ${about.subject} — everything I came up with was a plate of food rather than a dish anyone asks for by name. Try naming a dish, or give me another ingredient to pair it with.`;
}

/**
 * The short, replaceable line under the typing indicator — what the server is
 * doing RIGHT NOW, as distinct from the reply text above which is permanent.
 *
 * Separate from the intent line on purpose: one is a sentence the assistant
 * said, the other is a progress report that stops being true a few seconds
 * later and should disappear when the turn lands.
 */
export const STAGE_LABEL: Record<string, string> = {
    catalogue: "Checking your recipes",
    menu: "Choosing the courses",
    generate: "Writing a new one",
    persist: "Saving it",
    summary: "Finishing up",
};
