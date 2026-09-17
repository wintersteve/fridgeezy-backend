import { generateCompletion, type LlmProvider } from "@fridgeezy/llm";

/**
 * What to call the whole dinner.
 *
 * It sits apart from `naming-rules.ts` deliberately: those rules name a DISH,
 * and this one contradicts the most important of them. `DISH_NAME_RULE` strips
 * the cuisine out of a dish name because the card prints it as an eyebrow
 * directly above the title. A menu heading has no eyebrow — nothing beside it
 * says where the meal is from — so here the origin is the most useful thing the
 * title can carry. Do not "fix" this to match its sibling.
 *
 * ## It lives here rather than inside compose, and that is the whole file
 *
 * It was private to `generate-compose-suggestions.ts` while composing was the
 * only way a menu came into being. It is not any more: the pairing layer fills
 * most courses outright, and a menu whose every course was retrieved never
 * opens a compose stream at all — so the rule, the cap and the cleaner are read
 * by two callers now. One copy, because a second would drift into two houses
 * naming dinner two different ways, which the reader would meet as two kinds of
 * heading in one list.
 */
export const MENU_TITLE_RULE = `menu_title — a name for the WHOLE MEAL, alone on the FIRST line as {"menu_title": "..."} and carrying no other keys. Rules:
  - 2 to 4 words. It is drawn as a card heading and as a navigation title, and both truncate.
  - Name the MEAL, never the main dish. The main course's name is printed directly beneath this heading, so repeating it says nothing: "Coq au Vin" is not a menu title.
  - The cuisine, region or occasion IS worth carrying here, unlike in a dish name — nothing else beside this heading gives the meal an origin. "A Sunday in Burgundy", "Trattoria Lunch", "Thai Table", "Bistro Supper".
  - Say what the meal IS; do not praise it. "Autumn Sunday Roast" names a meal, "A Symphony of Autumn Flavours" reviews one.
  - Never claim an occasion the dishes do not support. No "Christmas", "Wedding" or "Birthday" unless these are actually those dishes.
  - No superlatives and no filler: not "Ultimate", "Perfect", "Delicious", "Feast", "Extravaganza", "Experience", "Journey". No exclamation marks, no closing punctuation. Title Case.`;

/**
 * Long enough for four words, short enough for a navigation bar.
 */
export const MENU_TITLE_MAX_LENGTH = 60;

/**
 * The title fit to show, or null to fall back to the main course's name.
 *
 * Sanitises rather than rejects, because this is a nicety riding on an expensive
 * stream: the frame is `parse`d inside the use case's streaming loop, where a
 * throw is caught as a STREAM FAILURE — so a rambling title would abort a
 * composition whose courses had all succeeded, and turn a cosmetic problem into
 * a paid one. Nothing downstream may depend on a title arriving.
 */
export const cleanMenuTitle = (raw: string): string | null => {
    const cleaned = raw
        .replace(/\s+/g, " ")
        .trim()
        // Models like to hand a title back already quoted.
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .trim();

    if (!cleaned) return null;

    // Dropped, not truncated. A heading cut off mid-word is worse than the main
    // course's name, which is what the client falls back to — and the fallback
    // is already the behaviour every menu saved before this shipped has.
    if (cleaned.length > MENU_TITLE_MAX_LENGTH) {
        console.warn(
            `[MenuTitle] Dropped menu title (${cleaned.length} chars): "${cleaned.slice(0, 80)}"`
        );
        return null;
    }

    return cleaned;
};

export interface MenuTitleCourse {
    /** `appetizer`, `main`, `side`, `dessert`. */
    courseType: string;
    name: string;
}

/**
 * The upper bound on what one request may describe.
 *
 * A menu is four course SLOTS, and a slot can legitimately hold more than one
 * dish — two sides is an ordinary dinner. Twelve is past anything the build
 * sheet can produce and still short enough that the prompt cannot be used as a
 * free text channel, which matters because this route carries no quota: see the
 * route's own note.
 */
export const MENU_TITLE_MAX_COURSES = 12;

/**
 * The model that names it, and the cheapest one in the file for a reason.
 *
 * The output is four words. Everything that makes a composition expensive —
 * dish invention, the notability gate, tagging, timing — has already happened
 * or is happening elsewhere; what is left is a labelling task a small model is
 * as good at as a large one, and one this runs on every committed menu.
 */
const MENU_TITLE_MODEL = "gpt-4.1-mini";

/**
 * Name a dinner somebody has just put together.
 *
 * The counterpart to the `menu_title` line compose emits, for the menus compose
 * never sees. Since the pairing layer began filling courses outright, the
 * common path to a saved menu runs entirely through retrieval — so the heading
 * fell back to the main course's name, which is the exact thing the title was
 * introduced to stop: "Coq au Vin" printed directly above a course row also
 * called "Coq au Vin" (see `borrowMenuTitle`, which fixed the same hole from
 * inside the stream and cannot reach this path).
 *
 * **Never throws, and null is an ordinary answer.** It is called on the commit
 * path, where the reader is waiting on a menu they have already paid to
 * generate — so a model that is slow, refused or talking nonsense costs a
 * nicer heading and must never cost the dinner. Every caller carries the main
 * course's name as its fallback, exactly as it did before this existed.
 */
export async function generateMenuTitle(params: {
    mainName: string;
    courses: MenuTitleCourse[];
    /** The meal's cuisine, when the caller knows it. Steers the origin half. */
    cuisine?: string | null;
    provider?: LlmProvider;
}): Promise<string | null> {
    const { mainName, courses, cuisine, provider } = params;

    // A "menu" of nothing but its main is a dish, and naming it as a meal would
    // put an invented occasion over a single recipe.
    if (courses.length < 2) return null;

    try {
        const { text } = await generateCompletion({
            model: { openai: MENU_TITLE_MODEL },
            label: "menu.title",
            system: [
                "You name a dinner somebody has put together, and nothing else.",
                "",
                `Answer with ONE JSON object and no prose: ${MENU_TITLE_RULE}`,
            ].join("\n"),
            user: [
                `main course: ${mainName}`,
                cuisine ? `cuisine: ${cuisine}` : "",
                "the whole meal, in the order it is eaten:",
                ...courses
                    .slice(0, MENU_TITLE_MAX_COURSES)
                    .map((course) => `- ${course.courseType}: ${course.name}`),
            ]
                .filter(Boolean)
                .join("\n"),
            json: true,
            // Four words, with room for the JSON around them. Bedrock's floor is
            // higher because its count includes the thinking it does first.
            maxTokens: { openai: 40, bedrock: 1024 },
            provider,
        });

        if (!text) return null;

        const parsed = JSON.parse(text) as { menu_title?: unknown };

        return typeof parsed.menu_title === "string"
            ? cleanMenuTitle(parsed.menu_title)
            : null;
    } catch (error) {
        // A title is a nicety; the menu is not. Same rule `borrowMenuTitle`
        // states, and the same fallback on the other side of the wire.
        console.error("[MenuTitle] naming the menu failed:", error);
        return null;
    }
}
