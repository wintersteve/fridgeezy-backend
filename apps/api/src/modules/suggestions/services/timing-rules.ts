/**
 * How a suggestion estimates the time a dish takes.
 *
 * Shared by all three generators — the batch feed
 * (`generate-suggestions-stream`), the single card (`stream-single-suggestion`)
 * and menu composition (`generate-compose-suggestions`) — for the reason
 * {@link DISH_NAME_RULE} is: three near-identical copies is how a prompt
 * difference gets reported as a model difference by the migration eval.
 *
 * ## What the number is FOR
 *
 * It is banded, not printed. The client renders quick / moderate / long
 * (`timeBandFor`, thresholds at 30 and 90 minutes), so the estimate only has to
 * land in the right band — which is roughly the accuracy an estimate of an
 * unwritten recipe actually has. Asking for a number and showing it to the
 * minute is what the previous version did, and the minute was invented.
 *
 * ## The overnight exclusion is the load-bearing half
 *
 * Without it this collapses. Count an overnight marinade or a slow prove and
 * every biryani, every sourdough, every kimchi and a good share of the desserts
 * report 12+ hours and land in `long` together — at which point the band
 * separates "needs a day of planning" from nothing at all, and the pill stops
 * carrying information for the dishes users most need it for.
 *
 * The question the band answers is "can I start this now and eat it", so the
 * clock starts when you start cooking. Unattended time that still pins you to
 * the kitchen (a braise, a roast) counts; unattended time you walk away from
 * for hours does not.
 */
export const DISH_TOTAL_TIME_RULE = `total_time_minutes — whole minutes from starting to cook until it is ready to eat, as an integer.
  - COUNT hands-on work AND unattended cooking that keeps you there: simmering, braising, roasting, baking, frying, resting a roast, reducing a sauce.
  - DO NOT COUNT long waits you walk away from: overnight marinating, chilling or setting, proving or rising dough, fermenting, soaking dried beans, thawing, or curing. A dish that marinates overnight and then grills for 15 minutes is 15 plus its prep — NOT 12 hours.
  - Estimate the STANDARD home version of the dish at the difficulty you gave it, for the servings a home cook would make. A harder version usually takes longer.
  - Be realistic in both directions: a stir fry is 15-25, a weeknight pasta 20-35, a curry or a bake 45-90, a braise or a slow roast 150-240. Do not round everything to 30 or 60.
  - One integer, no units, no range, no text: 45 — never "45 min", never "45-60".`;
