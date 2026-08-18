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
 *
 * ## The cuisine clause
 *
 * The card already prints the cuisine as an eyebrow directly above the title
 * ("Thai · Salad"), so "Spicy Thai Cabbage Salad" spends a third of its title on
 * a word the reader is looking at. Stripping it is safe because dish identity is
 * `(canonical_id, identity_cuisine)`: two cuisines may hold the same name and
 * `pickIdentityMatch` keeps them apart, so nothing downstream needs the name to
 * carry its origin.
 *
 * It is written as a TEST rather than "remove the demonym" for the same reason
 * the English default is. A blanket strip gives "Onion Soup", turns "Pad Thai"
 * into "Pad" and "Som Tam Thai" into "Som Tam" — which is a DIFFERENT dish, the
 * Lao one's name. The word is sometimes the label and sometimes the name, and
 * only usage tells you which.
 *
 * Measured through the naming gate on 2026-08-18 (gpt-4o, the `CUISINE_LABELLED`
 * / `CUISINE_IN_NAME` fixtures in `dedup-authenticity.eval.ts`): 10/10 labels
 * stripped, 10/10 real ones kept.
 *
 * The clause that had to be rewritten is (b), and the case that exposed it is
 * "Thai Fried Rice". At first it stripped on 2 runs out of 6, and the model was
 * not being sloppy — the rule contradicted itself. (b) said to keep the word
 * when the bare remainder names a DIFFERENT dish, and a bare "Fried Rice" does
 * name the Chinese one, so keeping "Thai" was a correct reading of what was
 * written. The dividing line that resolves it is whether the remainder is TRUE
 * of the dish: khao pad IS fried rice, so the word goes and the card's cuisine
 * line separates it from the Chinese dish; gỏi cuốn are NOT fried spring rolls,
 * so "Vietnamese" stays. With that stated it strips 6/6, and the keep side held
 * at 10/10 — including "Vietnamese Spring Rolls", which is the one a careless
 * sharpening of (b) would have taken.
 *
 * The clause that took three attempts is the variant marker surviving
 * TRANSLATION, and it is worth knowing that it was already broken before any of
 * this: the pre-change prompt renamed "Som Tam Thai" to a bare "Green Papaya
 * Salad" on 5 runs out of 5 — the LAO dish's name — because the English default
 * and the redundant-qualifier rule both pulled that way and nothing said the
 * marker had to come along. Stating that it does took it to 4/5, and adding the
 * pair by name ("Som Tam Thai" is not "Som Tam Lao") to 5/5. The failure is
 * quiet when it happens: the row merges into the other dish rather than erroring.
 */
export const DISH_NAME_RULE = `name — the name an English speaker would understand at a glance. Default to ENGLISH; a native name has to earn its place.
  - THE TEST: would this exact name appear, with no explanation next to it, in an English-language supermarket aisle, as the headline of a mainstream recipe site, or on a chain-restaurant menu? If yes, keep it. If you are unsure, it fails.
  - Names that PASS: Pad Thai, Pho, Ramen, Sushi, Tacos, Burrito, Hummus, Falafel, Pesto, Carbonara, Risotto, Gnocchi, Paella, Tiramisu, Kimchi, Naan, Curry, Gyoza, Tempura, Croissant, Guacamole, Churros, Baklava, Miso Soup, Coq au Vin.
  - Names that FAIL, and what to write instead: "Bánh Xèo" -> "Vietnamese Sizzling Pancake"; "Gỏi Cuốn" -> "Vietnamese Spring Rolls"; "Chè Ba Màu" -> "Three Colour Dessert"; "Pad Prik Khing" -> "Dry Curry with Green Beans"; "Tom Kha Gai" -> "Coconut Chicken Soup"; "Som Tam" -> "Green Papaya Salad"; "Ayam Geprek" -> "Smashed Fried Chicken"; "Canh Chua Ca" -> "Sweet & Sour Fish Soup"; "Murgh Makhani" -> "Butter Chicken"; "Pain Aux Bananes" -> "Banana Bread"; "Apfelstrudel" -> "Apple Strudel".
  - TIE-BREAKER, when the test above feels borderline: does the name tell an English reader what KIND of food this is — soup, cake, noodles, stew? "Chicken Katsu" and "Miso Soup" do. "Klepon", "Chawanmushi", "Okonomiyaki" and "Gado-Gado" do not, so they become "Sweet Rice Cake Balls", "Steamed Egg Custard", "Savoury Cabbage Pancake" and "Peanut Vegetable Salad". Street food and desserts fail this most often.
  - Cross-check against the gloss: if "description" ends up being a TRANSLATION of the name rather than an extra detail, the name failed the test. Fix the name, not the gloss.
  - Judge the whole name, not its parts: "Kimchi" passes on its own, but "Kimchi Jjigae" is met in English as "Kimchi Stew".
  - A cuisine filter does NOT change this rule. Being asked for Vietnamese dishes is not a reason to headline "Phở Bò" over "Beef Pho", to keep diacritics an English menu drops, or to write "Vietnamese" into every name to show you followed the filter.
  - The English name must still read as a NAME — as short as a menu heading, usually two to four words. Never a recipe summary: "Vietnamese Sizzling Pancake", NOT "Rice Flour Pancake with Pork, Shrimp and Bean Sprouts".
  - NEVER an invented name, and never one that lists its own ingredients: NOT "Carbonara with Mushrooms", NOT "Indian Tomato Butter Chicken". A dish that only exists as such a combination is not a dish — pick a different one.
  - DROP A QUALIFIER THAT ADDS NOTHING. If the qualifier names something the dish ALREADY IS by default, it is not part of the name: "Apple Tarte Tatin" -> "Tarte Tatin" (tarte tatin is apple), "Cucumber Sunomono" -> "Sunomono", "Beef Bourguignon with Red Wine" -> "Beef Bourguignon". THE TEST: would someone ordering the dish without the qualifier be served the same thing? If yes, drop it. KEEP a qualifier that marks a genuinely different dish — one whose defining ingredients or technique change: "Hiroshima-style Okonomiyaki", "Lao Green Papaya Salad", "Seafood Pajeon". This is the single biggest source of duplicate rows: the base dish and the redundantly-qualified one are stored as two, and users are shown the same dish twice.
  - THE CUISINE IS NOT PART OF THE NAME. It is already printed directly above the title on the card ("Thai · Salad"), so an origin word in the name is the same word twice: "Spicy Thai Cabbage Salad" -> "Spicy Cabbage Salad"; "Chinese Smashed Cucumber Salad" -> "Smashed Cucumber Salad"; "Indian Butter Chicken" -> "Butter Chicken"; "Northern Thai Pork Curry with Pickled Cabbage" -> "Pork Curry with Pickled Cabbage". THE TEST: is that word part of what the dish is CALLED, or is it saying where the dish is FROM? Only three kinds of name keep it:
    (a) The word is INSEPARABLE from the name — take it away and what is left is not the dish's name: Pad Thai, French Onion Soup, Greek Salad, Irish Stew, Spanish Omelette, Turkish Delight, Thai Basil Chicken, Som Tam Thai. This is NOT "an English menu would list it with its origin", which is true of half the catalog: "Thai Fried Rice" -> "Fried Rice", "Sichuan Boiled Fish" -> "Boiled Fish", "Thai Fish Cakes" -> "Fish Cakes". If the remainder still names the dish, the word goes.
    (b) The name is a translation and the bare remainder would name something this dish IS NOT: "Vietnamese Spring Rolls" (gỏi cuốn are fresh rolls, not the fried Chinese ones), "Vietnamese Sizzling Pancake" (a bare "Sizzling Pancake" names nothing at all). THE DIVIDING LINE: if the remainder is simply TRUE of the dish, it goes — even when another cuisine has a dish by that bare name. "Thai Fried Rice" -> "Fried Rice", because it IS fried rice; "Sichuan Boiled Fish" -> "Boiled Fish". Two cuisines are allowed to hold one name: the card prints the cuisine, and the catalog stores identity as the name PLUS the cuisine.
    (c) It is the only thing separating two real dishes that both exist: "Som Tam Thai" is not "Som Tam Lao", and "Hiroshima-style Okonomiyaki" is not the Osaka one. A marker like this SURVIVES TRANSLATION — "Som Tam Thai" becomes "Thai Green Papaya Salad", never a bare "Green Papaya Salad", which is the other dish's name.
    (d) It belongs to an INGREDIENT rather than to the dish: Chinese broccoli, Chinese cabbage, Thai basil, Swiss chard, Greek yogurt, Spanish onion, French beans, Italian sausage and Japanese eggplant are ingredients whose own names carry a place, and they are not the same thing as the plain version. "Crispy Pork with Chinese Broccoli" keeps its broccoli.
    Outside those four, drop it. And never ADD one that was not there: a cuisine word is not a way to make a vague name sound specific.
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
