/**
 * The canonical `component` tag vocabulary, mirroring `seeds/002_tags.sql`.
 *
 * A row carries one of these ONLY when it is a building block rather than a
 * finished dish, which makes it the one reliable way to tell "a sauce" from "a
 * dish that has a sauce in it" — similarity search cannot: "sauce for apple
 * strudel" scores highest against Apple Strudel itself, so a component question
 * always answered with the dish.
 *
 * `dish` is deliberately NOT in this list. It used to be, back when every recipe
 * was required to carry a component and `dish` was the catch-all for the 87% that
 * were not components at all. Now absence carries that meaning, so a `dish` entry
 * would be a filter value matching nothing — and worse, an option the chat model
 * could pick, silently emptying the results for an ordinary request. Omitting the
 * parameter is how "an ordinary dish" is expressed.
 */
export const COMPONENT_TAGS = [
    "sauce",
    "stock",
    "gravy",
    "roux",
    "slurry",
    "spice blend",
    "paste",
    "rub",
    "marinade",
    "brine",
    "cure",
    "dough",
    "batter",
    "pastry",
    "vinaigrette",
    "dressing",
    "custard",
    "curd",
    "caramel",
    "crumb",
    "pickle",
    "jam",
    "compote",
    "syrup",
    "glaze",
    "icing",
    "puree",
] as const;

export type ComponentTag = (typeof COMPONENT_TAGS)[number];

/**
 * The tag that marks a row as a building block regardless of WHICH kind it is.
 * A ragù carries `sauce` and `component`; either is enough.
 */
const COMPONENT_MARKER = "component";

const normalise = (tag: string) => tag.trim().toLowerCase();

/** Is this dish a building block rather than a finished plate? */
export function isComponentDish(tags: Array<string | { name: string }>): boolean {
    return tags.some((tag) => {
        const name = normalise(typeof tag === "string" ? tag : tag.name);
        return (
            name === COMPONENT_MARKER ||
            (COMPONENT_TAGS as readonly string[]).includes(name)
        );
    });
}

/**
 * Two dishes that CANNOT be the same thing, however similar they look.
 *
 * ## Why this overrules the signature, auto-merge included
 *
 * A component and the dish built on it share nearly every ingredient, so their
 * signatures score higher against each other than most genuine duplicates do —
 * which is the one case similarity is structurally incapable of judging, and it
 * is written down elsewhere in this repo twice: "similarity alone always scores
 * a bechamel query highest against Lasagne", and the `from` parameter on
 * `/recipes/new` exists because "a component's name is by construction similar
 * to the dish that uses it".
 *
 * Measured 2026-08-24: "Give me a Ragu recipe" generated a correct Ragù,
 * `findRecipeForDish` folded it into the catalogue's **Lasagna**, and the chat
 * answered a request for a sauce with a baked pasta dish. The tags said so all
 * along — the ragù carried `sauce`, the lasagne did not — and nothing was
 * reading them.
 *
 * So this is a hard gate applied BEFORE the score is consulted. It is
 * deliberately one-directional in effect: it can only ever keep two rows apart,
 * never merge two that the signature considers distinct.
 */
export function componentsDisagree(
    a: Array<string | { name: string }>,
    b: Array<string | { name: string }>
): boolean {
    return isComponentDish(a) !== isComponentDish(b);
}
