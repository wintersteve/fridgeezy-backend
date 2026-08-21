/**
 * What the three difficulty levels MEAN, in one copy.
 *
 * Shared by every generator that either picks a difficulty or writes to one:
 * the batch feed (`generate-suggestions-stream`), the single card
 * (`stream-single-suggestion`), menu composition
 * (`generate-compose-suggestions`), both recipe writers (`generate-recipe`,
 * `promote`), the rewrite (`escalate-difficulty`) and the OCR import
 * (`read-recipe-from-image`). Extracted for the reason {@link DISH_NAME_RULE}
 * and {@link DISH_TOTAL_TIME_RULE} were — except that difficulty had already
 * suffered the failure those two were extracted to prevent, and had been living
 * with it: five wordings, two of which placed the same word a full rung apart.
 *
 * ## The scale STARTS at the real dish
 *
 * `easy` is the standard version a competent home cook makes — NOT a
 * beginner's simplification. The ladder then climbs through restaurant cooking
 * to a composed plate. There is deliberately no rung below the real dish.
 *
 * That is the second placement this rule has had, and the change was made on
 * evidence rather than taste. `difficulty-ladder.eval.ts` measured the previous
 * scale, whose bottom rung was "beginner-friendly", at three runs per level:
 * `easy` and `medium` came out barely distinguishable — Tomato Soup scored
 * 4.7 vs 5.3 steps, IDENTICAL tool counts and identical total time, and Coq au
 * Vin's medium landed BELOW its easy on step count, the same way on all three
 * runs. Three labels were buying about two distinguishable rungs, and the
 * flat pair was at the bottom.
 *
 * Two things caused that, and both are fixed here:
 *
 * - **A dish's floor is the dish.** Most of this catalogue is already
 *   approachable, so "make it simpler than normal" had nowhere to go on a
 *   tomato soup and the model correctly declined to invent somewhere. The rungs
 *   with real headroom are all ABOVE the standard version.
 * - **`medium` was defined by negation** — "nothing simplified away and nothing
 *   added for effect" — which tells a model what not to do and gives it nothing
 *   to reach for. Every rung now names something positive to add.
 *
 * ## The top rung says "Michelin-starred" on purpose
 *
 * It is the phrase that measurably works. Steering the model with it produces a
 * genuinely restructured dish — sub-preparations, engineered texture contrast,
 * composed plating — where "elevated or advanced" produced the same recipe with
 * longer sentences. The word appears HERE, in a prompt, as a description of a
 * kind of cooking. It must not become a user-facing tier LABEL: Michelin is an
 * actively enforced trademark of a tyre manufacturer and its guide, and the
 * app's own star metaphor ("3-Star Chef") already carries the idea without it.
 *
 * ## The identity risk moved to the top of the ladder
 *
 * On the old scale the danger was at the bottom: `easy` gutting a dish of the
 * ingredient that defined it — the `GUTTED_DISHES` class, a ceviche of
 * garnishes with impeccable name and tags. With no simplification rung left,
 * that pressure is gone and the opposite one arrives: a top rung told to
 * reinterpret can deconstruct a carbonara into a foam and a tuile and hand back
 * something that is no longer the dish. Hence the explicit clause below, and
 * hence `difficulty-ladder.eval.ts` asserting defining-ingredient presence at
 * EVERY level rather than only the lowest.
 *
 * ## Two clauses that are load-bearing
 *
 * **Skill, not time.** Without it the model answers "harder" with "longer", and
 * the two are separately reported — `total_time_minutes` on a suggestion,
 * `prepTime`/`cookTime` on a recipe. Note the eval shows time climbing anyway,
 * which is a consequence of real added method rather than a trade, but it does
 * push a dish across `timeBandFor`'s 90-minute boundary: hard Tomato Soup
 * measured 110 minutes against easy's 45, so the same dish answers a different
 * time filter at a different rung.
 *
 * **Every level is authentic.** `verifySuggestionAuthenticity` runs before
 * anything is persisted and drops an invention as `invention` — after the card
 * has been drawn and paid for. This clause is what keeps the top rung's licence
 * to reinterpret from reading as licence to invent.
 *
 * ## Existing rows do not fix themselves
 *
 * Dedup RESOLVES to the stored suggestion or recipe rather than regenerating
 * it, so this governs dishes nobody has generated yet. Everything already in
 * the catalogue keeps the label the prompt of the day gave it, and there is now
 * more than one previous day. There is deliberately no repair script: unlike a
 * name, a difficulty cannot be corrected by inspection, so fixing a row means
 * regenerating it.
 *
 * **Two things outside this file have to move with it**, and neither will fail
 * if forgotten: `profile_settings.difficulty` defaults to `'medium'`, which on
 * this scale makes restaurant cooking the default skill for every new account
 * and ranks their whole feed around it; and the client's `SKILL_LEVELS` copy
 * still describes 1-Star as "simple recipes with basic techniques", a rung this
 * scale no longer has.
 */
export const DIFFICULTY_RULE = `## Difficulty Levels
Difficulty is the SKILL the dish asks of the cook — not how long it takes. A three-hour braise is easy; a five-minute hollandaise is not. Time is reported in its own fields, so never trade one against the other.
- "easy": The standard version a competent home cook makes. The dish's usual techniques, at its usual level of care. This is the real dish, cooked properly — it is the BOTTOM of the scale, not a simplified version of something else, so never strip a technique or a component out to reach it.
- "medium": A sophisticated, chef-level interpretation. Advanced technique where the dish rewards it, components made from scratch that the standard version buys in (stock, pasta, pastry, cure, spice paste), precise timing and temperature, and finishing that would not be out of place in a good restaurant.
- "hard": The version a Michelin-starred kitchen would send out. Every component made in-house and treated as its own preparation; technique chosen for a specific effect on texture or flavour rather than for difficulty; seasoning and doneness controlled to the degree and the minute; deliberate contrast of texture and temperature on the plate; and a composed presentation described as part of the method, not tacked on. Write it as a cook would work it — the sub-preparations first, saying what can be made ahead, then the assembly.
Three things hold at EVERY level:
- The level never changes WHICH dish it is. A defining ingredient stays in at every rung, and the top rung is an expression of the dish, never a deconstruction of it: if a diner could not name the dish from the plate, you have gone too far.
- Every level is authentic. The scale adds craft to a real dish; it never invents one.
- Climb by adding METHOD, not adjectives. Rewriting "fry" as "sauté and deglaze" over an unchanged method is the same recipe described differently, and is the failure to avoid.`;
