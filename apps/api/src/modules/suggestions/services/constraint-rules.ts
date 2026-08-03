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
  - Skip the dish ONLY when the blacklisted item IS the dish and nothing survives its removal (cheese in Cacio e Pepe, rice in risotto). Then suggest a different authentic dish instead.
  - Never reintroduce a blacklisted item anywhere else — not in a garnish, not in a serving suggestion.

DIETARY RESTRICTIONS (if provided) are NOT the same thing and are not negotiable: the dish itself must genuinely satisfy every one of them, unadapted.`;

/** The `adaptedFor` output field, described for the JSONL key list. */
export const ADAPTED_FOR_RULE = `adaptedFor — array of the blacklisted ingredient names you replaced, exactly as given. [] when the dish is unchanged.`;
