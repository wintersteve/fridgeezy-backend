import { CARD_DESCRIPTION_MAX } from "@fridgeezy/schemas";

/**
 * How a suggestion names a dish and glosses it.
 *
 * Shared by the batch generator (`generate-suggestions-stream`) and the single
 * generator (`stream-single-suggestion`) for the same reason
 * `buildSuggestionsUserPrompt` is: the two carried near-identical copies, and a
 * copy is how the model-migration eval ends up reporting a prompt difference as
 * a model difference.
 *
 * The default is ENGLISH, and that direction matters. Written the other way up
 * — keep the native name unless it clearly fails — the model's instinct won
 * every borderline call and the feed filled with *Pain Aux Bananes*, *Canh Chua
 * Ca*, *Bánh Xèo* and *Pad Prik Khing*. Flipping the default is the whole fix;
 * the examples only calibrate where the bar sits.
 *
 * The bar is a TEST, not a list. A list can only cover the dishes whoever wrote
 * it happened to think of, and its omissions do real damage: "Hummus",
 * "Tacos" and "Pesto" would be "translated" into nonsense by a rule that only
 * whitelists what it remembers.
 *
 * It still has to fail in both directions. Over-correcting produces "Carbonara
 * with Mushrooms" (not a dish) or a recipe summary standing in for a name.
 */
export const DISH_NAME_RULE = `name — the name an English speaker would understand at a glance. Default to ENGLISH; a native name has to earn its place.
  - THE TEST: would this exact name appear, with no explanation next to it, in an English-language supermarket aisle, as the headline of a mainstream recipe site, or on a chain-restaurant menu? If yes, keep it. If you are unsure, it fails.
  - Names that PASS: Pad Thai, Pho, Ramen, Sushi, Tacos, Burrito, Hummus, Falafel, Pesto, Carbonara, Risotto, Gnocchi, Paella, Tiramisu, Kimchi, Naan, Curry, Gyoza, Tempura, Croissant, Guacamole, Churros, Baklava, Miso Soup, Coq au Vin.
  - Names that FAIL, and what to write instead: "Bánh Xèo" -> "Vietnamese Sizzling Pancake"; "Gỏi Cuốn" -> "Vietnamese Spring Rolls"; "Chè Ba Màu" -> "Three Colour Dessert"; "Pad Prik Khing" -> "Thai Dry Curry with Green Beans"; "Tom Kha Gai" -> "Coconut Chicken Soup"; "Som Tam" -> "Green Papaya Salad"; "Ayam Geprek" -> "Smashed Fried Chicken"; "Canh Chua Ca" -> "Vietnamese Sweet & Sour Fish Soup"; "Murgh Makhani" -> "Butter Chicken"; "Pain Aux Bananes" -> "Banana Bread"; "Apfelstrudel" -> "Apple Strudel".
  - TIE-BREAKER, when the test above feels borderline: does the name tell an English reader what KIND of food this is — soup, cake, noodles, stew? "Chicken Katsu" and "Miso Soup" do. "Klepon", "Chawanmushi", "Okonomiyaki" and "Gado-Gado" do not, so they become "Sweet Rice Cake Balls", "Steamed Egg Custard", "Savoury Cabbage Pancake" and "Peanut Vegetable Salad". Street food and desserts fail this most often.
  - Cross-check against the gloss: if "description" ends up being a TRANSLATION of the name rather than an extra detail, the name failed the test. Fix the name, not the gloss.
  - Judge the whole name, not its parts: "Kimchi" passes on its own, but "Kimchi Jjigae" is met in English as "Kimchi Stew".
  - A cuisine filter does NOT change this rule. Being asked for Vietnamese dishes is not a reason to headline "Phở Bò" over "Beef Pho", or to keep diacritics an English menu drops.
  - The English name must still read as a NAME — as short as a menu heading, usually two to four words. Never a recipe summary: "Vietnamese Sizzling Pancake", NOT "Rice Flour Pancake with Pork, Shrimp and Bean Sprouts".
  - NEVER an invented name, and never one that lists its own ingredients: NOT "Carbonara with Mushrooms", NOT "Indian Tomato Butter Chicken". A dish that only exists as such a combination is not a dish — pick a different one.
  - No parentheses and no second name here. The native spelling goes in "name_alt"; the gloss goes in "description".`;

/**
 * The card gloss — the parenthetical that follows the name on a recipe site,
 * with the brackets' contents becoming `description`.
 *
 * It adds a DETAIL. It is not a translation service for a name that should have
 * been in English: {@link DISH_NAME_RULE} uses "is the gloss just translating
 * the name?" as its own self-check, so leaning on the gloss to rescue an
 * unreadable title breaks both fields at once.
 *
 * The limit is two under the schema's clamp: the clamp appends an ellipsis, and
 * an ellipsis is the truncation this is trying to avoid.
 */
export const DISH_GLOSS_RULE = `description — the gloss that would follow the name in brackets on a recipe site.
  - TWO TO FIVE WORDS, and never more than ${CARD_DESCRIPTION_MAX - 2} characters including spaces. It is drawn on ONE line that cannot wrap.
  - Say what the dish IS, then STOP. Shorter is better. Never pad it out towards the limit, and never append extra ingredients to fill it: "Hot sour shrimp soup", NOT "Hot sour shrimp soup, tomatoes".
  - A bare noun phrase: sentence case, no verb, no leading article, no closing period.
  - On the rare dish that keeps a native name (Pad Thai, Ramen), say what it is in plain English: "Stir-fried rice noodles".
  - Otherwise the name already says what the dish is, so do NOT restate it — give the one detail that distinguishes this version: "Dark rum, toasted walnuts" for Banana Bread, not "Sweet banana loaf".`;

/**
 * `name_alt` became load-bearing the moment {@link DISH_NAME_RULE} started
 * defaulting to English: the native spelling now survives NOWHERE else.
 *
 * It reaches the `recipes.name_en` / `recipe_suggestions.name_en` column, which
 * despite its name holds the alternate — and that column is half of both
 * `ilike` search filters in the app and the whole of dedup's cheapest layer
 * (`findBaseRecipe([name, nameEn])`). A dish anglicised to "Sweet Rice Cake
 * Balls" with a null alt cannot be found by anyone typing "Klepon", and no
 * longer exact-matches an existing row stored under the native name.
 *
 * The requirement still has to be one-directional. It used to be a required
 * `z.string()`, which forced the model to echo `name` or invent a translation
 * nobody uses — so "null when there is genuinely no second name" stays, with
 * Western dishes named as the examples that must keep taking it.
 */
export const DISH_NAME_ALT_RULE = `name_alt — the OTHER name for the same dish.
  - When "name" is English and the dish HAS a native name, name_alt MUST carry it: "Green Papaya Salad" -> "Som Tam", "Steamed Egg Custard" -> "Chawanmushi", "Sweet Rice Cake Balls" -> "Klepon", "Beef Rendang" -> "Rendang Daging". This is the ONLY place the native name survives, and it is what someone searching for the dish will type — leaving it null makes the dish unfindable under the name its own cuisine uses.
  - ALWAYS write it in the LATIN alphabet — the romanisation, never the native script: "Chawanmushi" NOT "茶碗蒸し", "Miso Shiru" NOT "味噌汁", "Kimchi Jjigae" NOT "김치찌개". Diacritics are fine ("Phở Bò", "Gỏi Cuốn"). This field exists to be matched against what a user types on a Latin keyboard; a name in its own script can never be typed and is the same as leaving it null.
  - When "name" is a native name that passed the test above, name_alt is the English one.
  - It MUST be this dish's own name in its OWN cuisine's language. Never borrow another cuisine's name for a similar dish: a Chinese steamed egg custard is "Zheng Dan Geng", NOT the Japanese "Chawanmushi". A wrong one is worse than null — it merges two different dishes.
  - If you cannot give a name that DIFFERS from "name", use null. Repeating "name" here is never correct.
  - Use null ONLY when the dish genuinely has no second name: Banana Bread, Caesar Salad, Beef Stew, Apple Pie. Never invent one by translating an English name into another language — a rendering nobody says is worse than null.`;
