/**
 * What a suggestion does with the user's blacklist.
 *
 * It used to drop the dish: "Do NOT include recipes where a blacklisted item is
 * normally present". That reads as safe and is not — blacklisting one staple
 * (fish sauce, dairy, pork) silently removed whole cuisines from discovery, and
 * the user saw no dishes rather than adapted ones. Since 2026-08-03 the dish
 * stays and the ingredient is swapped, which costs nothing extra: the
 * suggestion's ingredient list is what `promote` is allowed to build the recipe
 * from, so a substitute chosen here is a substitute the recipe inherits.
 *
 * Dietary restrictions stay absolute, and are called out here so the model does
 * not generalise the new leniency onto them.
 */
export const BLACKLIST_RULE = `BLACKLIST (if provided) — ingredients the user will not eat. Do NOT drop a dish because of them:
  - Leave the blacklisted item OUT of "ingredients" and put the closest authentic substitute in its place (fish sauce -> light soy sauce; butter -> olive oil). Pick a swap real cooks actually make for that cuisine.
  - Name every blacklisted item you swapped out in "adaptedFor", spelled exactly as it was given. Use [] when the dish needed no change — most dishes will not.
  - Skip the dish when the blacklisted item IS the dish and nothing recognisable survives its removal: cheese in Cacio e Pepe, rice in risotto, seafood in ceviche, egg and cured pork in Carbonara, papaya in Green Papaya Salad. Then suggest a different authentic dish instead.
  - THE TEST for that: strike the blacklisted item from the list and ask whether what remains is still the named dish. Ceviche minus the seafood leaves lime, onion, chili, sweet potato and corn — those are ceviche's GARNISHES, and a plate of garnishes is not a ceviche. When the answer is no, do NOT keep the name and swap the ingredient: pick a different dish. A real dish's name on a dish that is not it is the worst output you can produce here, worse than returning one fewer suggestion.
  - Never reintroduce a blacklisted item anywhere else — not in a garnish, not in a serving suggestion.

DIETARY RESTRICTIONS (if provided) are NOT the same thing and are not negotiable: the dish itself must genuinely satisfy every one of them, unadapted. Choose a dish that is ALREADY vegan/vegetarian/gluten-free in its authentic form — every cuisine has them. Never take a dish that is not and strip what disqualifies it: a vegan "Ceviche de Mariscos" is not a ceviche, and labelling it "a vegan take on..." in the description does not make the name honest. When a restriction rules out the obvious dish, change the dish, never the recipe.`;

/**
 * Scope: this catalog holds FOOD.
 *
 * The FIRST line of defence, not the gate — `verifySuggestionAuthenticity`
 * returns `not_food` and is what actually stops a drink being persisted. This
 * rule exists so the common case never reaches it: a drink that gets generated
 * still costs an authenticity call to reject, plus a provisional card the client
 * has to draw and then withdraw.
 *
 * Shared across all three generators (batch, single, compose) because a rule
 * enforced in one prompt and not the others is worse than no rule — it makes the
 * scope look like a property of one endpoint rather than of the catalog.
 *
 * **The axis is "is it drunk", not "does it contain alcohol".** Those come apart
 * in both directions and the wrong one breaks real cooking: coq au vin, tiramisu
 * and beer-battered fish are food, while a virgin daiquiri is not. Getting this
 * backwards would strip wine and beer out of a large slice of European cuisine.
 */
export const FOOD_ONLY_RULE = `FOOD ONLY. This catalog holds things you EAT. Never suggest something whose purpose is to be DRUNK — no cocktails or mixed drinks, no wine, beer or spirits, no mocktails, smoothies, milkshakes, lassi, horchata, juice, hot chocolate, coffee or tea drinks. This holds whether or not the drink contains alcohol.
  - Soup, broth, consommé and gazpacho ARE food — they are eaten from a bowl with a spoon, even when sipped from a cup.
  - A dish that CONTAINS a drink is food and is welcome: coq au vin, beer-battered fish, risotto with white wine, bourbon-glazed ribs and tiramisu are all fine. NEVER drop a dish because alcohol appears in its ingredients.
  - When the request asks for a drink and nothing else — "mojito", "cocktails", "something to sip" — return nothing rather than substituting a food dish that shares its flavours. Someone asking for a Mojito does not want a lime tart, and a card they did not ask for is worse than no card.`;

/** The `adaptedFor` output field, described for the JSONL key list. */
export const ADAPTED_FOR_RULE = `adaptedFor — array of the blacklisted ingredient names you replaced, exactly as given. [] when the dish is unchanged.`;
