/**
 * The temperature rules every instruction-emitting prompt shares — `promote`,
 * `generate-recipe`, `escalate-difficulty` and `modify-recipe`.
 *
 * Shared for the same reason {@link HEADER_DESCRIPTION_RULES} is: all four write
 * steps, so a rule that lives in three of them is a rule the fourth quietly
 * undoes. Escalating or modifying a recipe rewrites its instructions wholesale,
 * which would reintroduce Fahrenheit into a recipe that was generated clean.
 *
 * Before this, **no prompt in the repo mentioned units at all**, so the model
 * volunteered whichever it liked and often both — "180°C (350°F)" in a step,
 * where the cook needs one number. `step-structure.eval.ts` measures it: the
 * shipped prompt produced dual-unit and Fahrenheit steps, and adding this block
 * took both to zero across three dishes.
 *
 * Celsius rather than a user preference because there is nowhere to store one —
 * a recipe's steps are generated once and persisted as text, so the unit is
 * baked in at write time. Converting for display later is a client concern and
 * only possible if what we store is unambiguous, which is what this guarantees.
 */
export const TEMPERATURE_RULES = `## Temperature Rules
- Write every temperature in Celsius ONLY, as a whole number followed by °C (e.g. "180°C").
- NEVER give a second unit in parentheses. Write "180°C", never "180°C (350°F)", and never "350°F" on its own.
- For a fan/convection oven give the Celsius figure the recipe actually uses; do not append a conversion.`;

/**
 * Asks for the step's duration as a number beside the sentence, rather than
 * leaving the client to mine it back out of the prose.
 *
 * The model is markedly better at this than a parser can be, and
 * `step-structure.eval.ts` measures the gap: it returned 900s for "about 5
 * minutes per batch" across three batches, and 1800s for "After 2 hours
 * braising, continue for 30 minutes" — correctly reading the two hours as a
 * recap of the previous step. A regex answers 300s and 9000s. Coverage was 100%
 * of the steps whose text states a duration.
 *
 * "Still mention it in the sentence" matters: the text is what the reader
 * actually reads, and a step stripped down to "Braise." with the time hidden in
 * a field would be worse prose for the sake of tidier data.
 */
export const STEP_DURATION_RULES = `## Step Duration
- Every instruction line MUST carry "durationSeconds": how long that step takes or waits, in whole seconds.
- Use the LOWER bound of a range ("25-30 minutes" is 1500), and the TOTAL where a step repeats ("5 minutes per batch" over 3 batches is 900).
- Count only THIS step's own time. When a step opens by recapping a previous one ("After 2 hours braising, stir in..."), that earlier span belongs to the earlier step — do not include it here.
- OMIT the field entirely for a step with no meaningful duration ("Season to taste"). Never write 0.
- The step's "text" MUST still state the time in words as it always did; this field is in addition to the sentence, never a replacement for it.

## Step Temperature
- An instruction line that sets or depends on a temperature MUST carry "temperatureC": that temperature in whole degrees CELSIUS, as a number (180, not "180°C").
- This covers oven settings, oil and water temperatures, and a target internal doneness.
- OMIT the field entirely for a step with no temperature. Never write 0 to mean "none".
- The step's "text" MUST still state the temperature in words, in Celsius, exactly as the Temperature Rules require.

## Step Equipment
- An instruction line MAY carry "equipment": an array of the main tools that step needs, e.g. ["oven","roasting tin"].
- Name only what the cook has to have ready: pans, pots, trays, ovens, blenders, thermometers. NOT everyday hand tools such as a spoon, knife, bowl or whisk.
- Write them lowercase and singular ("dutch oven", not "Dutch Ovens").
- List at most two per step, most important first.
- OMIT the field entirely when the step needs nothing worth naming. Never write an empty array.`;
