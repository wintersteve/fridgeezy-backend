import type { ExampleRecipe } from "./recipe";

/**
 * One real recipe from the catalogue, frozen as a fixture.
 *
 * ## Why this is DATA IN THE REPO and not a fetch
 *
 * The site build reads nothing but `src/`. It holds no Supabase credentials,
 * talks to no network and renders the same bytes on every machine, which is
 * what makes it safe to run from CI, from a laptop, or from the deploy script
 * without anybody thinking about secrets. Fetching a recipe at build time would
 * trade all of that for freshness the page does not need.
 *
 * It also closes a failure the share route had to guard by hand. That route
 * reads through the service role, so nothing upstream filters a withdrawn dish
 * — its own comment records having to check `hidden_at` explicitly, or a recipe
 * pulled from the entire app would carry on serving its own public page. A
 * BUILD-TIME fetch has a worse version of that: the page would be a snapshot in
 * S3, still serving after the dish was hidden, until somebody redeployed. A
 * committed fixture cannot drift that way, because it is not claiming to be
 * live — it is an example, chosen once.
 *
 * The cost is stated rather than hidden: if this dish is edited in the
 * catalogue, this file does not follow. Re-capture it deliberately, the way you
 * would update any other copy on the site.
 *
 * ## If a page per recipe is ever wanted
 *
 * This is the shape to grow, not to throw away — `recipe.tsx` renders an
 * `ExampleRecipe` and knows nothing about where it came from, so the catalogue
 * version is the same renderer over an array. What that needs on top is
 * credentials in the build, the `hidden_at` and `created_by` filters the share
 * route writes out by hand, a sitemap, and a redeploy cadence tight enough that
 * a withdrawn dish stops serving. That is a decision, not a refactor.
 */
export const EXAMPLE_RECIPE: ExampleRecipe = {
    id: "b1e67cf2-8d04-4bb9-bfd4-1639b1ce134d",
    slug: "chicken-nuggets",
    name: "Chicken Nuggets",
    shortDescription: "Crispy breaded chicken bites",
    description: "Crispy breaded chicken bites made from hand-cut chicken breast marinated in spiced buttermilk, double-dredged, then fried to perfection and served with a…",
    cuisine: "american",
    difficulty: "hard",
    servings: 2,
    prepTime: "80 min",
    cookTime: "65 min",
    totalTimeMinutes: 145,
    nutrition: { kcal: 690, carbs: 55, protein: 54, fat: 28 },
    image: "/assets/recipes/chicken_nuggets.webp",
    tags: [
        { type: "course", name: "main" },
        { type: "cuisine", name: "american" },
        { type: "dietary", name: "nut free" },
        { type: "dietary", name: "sesame free" },
        { type: "dietary", name: "shellfish free" },
        { type: "dietary", name: "soy free" },
    ],
    ingredients: [
        {
            name: "Chicken Breast",
            quantity: 2,
            unit: "pc",
            unitType: "count",
            note: "about 300 g total, trimmed, cut into 2.5 cm chunks",
        },
        {
            name: "Paprika",
            quantity: 2,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Neutral Oil",
            quantity: 700,
            unit: "ml",
            unitType: "volume",
            note: "for frying",
        },
        {
            name: "Buttermilk",
            quantity: 250,
            unit: "ml",
            unitType: "volume",
            note: null,
        },
        {
            name: "Baking Powder",
            quantity: 1,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Cornstarch",
            quantity: 30,
            unit: "g",
            unitType: "weight",
            note: null,
        },
        {
            name: "Sugar",
            quantity: 1,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Egg",
            quantity: 1,
            unit: "pc",
            unitType: "count",
            note: null,
        },
        {
            name: "Black Pepper",
            quantity: 1,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Salt",
            quantity: 2,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "White Bread",
            quantity: 2,
            unit: "slice",
            unitType: "count",
            note: "stale or lightly toasted",
        },
        {
            name: "All-Purpose Flour",
            quantity: 60,
            unit: "g",
            unitType: "weight",
            note: null,
        },
        {
            name: "Onion Powder",
            quantity: 2,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Garlic Powder",
            quantity: 2,
            unit: "tsp",
            unitType: "volume",
            note: null,
        },
        {
            name: "Panko Breadcrumbs",
            quantity: 60,
            unit: "g",
            unitType: "weight",
            note: null,
        },
    ],
    steps: [
        {
            number: 1,
            image: "/assets/recipes/chicken-nuggets-steps/1.webp",
            title: "Blend and toast fresh bread crumbs",
            text: "Tear the white bread into pieces, pulse in a food processor until coarse crumbs form, then spread on a baking tray and toast in a 120°C oven for 15 minutes until dry and lightly golden. Set aside to cool.",
            durationSeconds: 1500,
            temperatureC: 120,
            equipment: ["oven"],
        },
        {
            number: 2,
            image: "/assets/recipes/chicken-nuggets-steps/2.webp",
            title: "Prepare spiced buttermilk marinade",
            text: "In a bowl, whisk together buttermilk, 1 tsp paprika, 1 tsp onion powder, 1 tsp garlic powder, 1 tsp salt, 0.5 tsp black pepper, and sugar until the seasonings are dissolved.",
            durationSeconds: 120,
        },
        {
            number: 3,
            image: "/assets/recipes/chicken-nuggets-steps/3.webp",
            title: "Marinate chicken in spiced buttermilk",
            text: "Add the chicken chunks to the spiced buttermilk, toss to coat well, cover and refrigerate for 1 hour to tenderize and infuse with flavour.",
            durationSeconds: 3600,
        },
        {
            number: 4,
            image: "/assets/recipes/chicken-nuggets-steps/4.webp",
            title: "Assemble seasoned dredging flour",
            text: "In a shallow dish, mix together all-purpose flour, cornstarch, baking powder, remaining paprika, remaining onion powder, remaining garlic powder, 1 tsp salt, and remaining black pepper until evenly combined.",
            durationSeconds: 180,
        },
        {
            number: 5,
            image: "/assets/recipes/chicken-nuggets-steps/5.webp",
            title: "Mix panko and fresh bread crumbs for…",
            text: "Combine the prepared toasted bread crumbs with panko in another shallow dish and gently toss to blend for a layered, crunchy finish.",
            durationSeconds: 120,
        },
        {
            number: 6,
            image: "/assets/recipes/chicken-nuggets-steps/6.webp",
            title: "Set up breading station",
            text: "Crack the egg into a bowl and beat until combined. Arrange the seasoned flour, beaten egg, and mixed breadcrumbs in a row for efficient double-dipping.",
            durationSeconds: 60,
        },
        {
            number: 7,
            image: "/assets/recipes/chicken-nuggets-steps/7.webp",
            title: "Bread the marinated chicken",
            text: "Remove chicken from the marinade one piece at a time. Coat thoroughly in flour mixture, dip in egg, then firmly press into the crumb mix, making sure every surface is coated and pressing crumbs on for maximum coverage. Place breaded pieces on a wire rack. Repeat with all pieces.",
            durationSeconds: 1200,
        },
        {
            number: 8,
            image: "/assets/recipes/chicken-nuggets-steps/8.webp",
            title: "Rest breaded chicken to dry coating",
            text: "Let breaded chicken rest uncovered on the rack for 20 minutes at room temperature so the crust dries and adheres well.",
            durationSeconds: 1200,
        },
        {
            number: 9,
            image: "/assets/recipes/chicken-nuggets-steps/9.webp",
            title: "Heat oil for deep frying",
            text: "Pour neutral oil into a deep heavy pot to a depth of at least 5 cm and heat to 170°C. Use a thermometer to monitor the temperature for safety and precision.",
            durationSeconds: 600,
            temperatureC: 170,
            equipment: ["pot"],
        },
        {
            number: 10,
            image: "/assets/recipes/chicken-nuggets-steps/10.webp",
            title: "Deep-fry chicken nuggets in batches",
            text: "Fry the breaded chicken pieces in hot oil, several at a time, without crowding, for 5–7 minutes each batch until deep golden brown, crunchy, and cooked through (internal temp 74°C). Turn pieces as needed. Drain on a rack or paper towels between batches. Repeat until all are cooked.",
            durationSeconds: 1500,
            temperatureC: 170,
            equipment: ["pot"],
        },
        {
            number: 11,
            image: "/assets/recipes/chicken-nuggets-steps/11.webp",
            title: "Season and serve crispy chicken nuggets",
            text: "While still hot, immediately sprinkle the fried nuggets with the remaining salt and serve at once for maximum crunch.",
            durationSeconds: 60,
        },
    ],
    tips: [
        "For the best texture, allow the breaded nuggets to chill uncovered on a wire rack to help dry the coating before frying.",
        "Use a thermometer to keep the fry oil at a steady 170°C for even, crisp results and no greasy spots.",
        "Pulse the white bread into slightly coarse, fluffy crumbs and toast them for added crunch in your coating mix.",
    ],
    capturedOn: "2026-09-23",
};
