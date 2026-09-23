/**
 * The food-safety floor every instruction-AUTHORING prompt shares — `promote`,
 * `generate-recipe`, `escalate-difficulty` and `modify-recipe`.
 *
 * Shared for the reason {@link TEMPERATURE_RULES} is, with a sharper edge: all
 * four write steps, and two of them REWRITE a recipe that was generated clean.
 * A safety line that lives in three of them is one the fourth quietly undoes —
 * and here the thing being undone is a cooking temperature rather than a unit.
 *
 * Before this, **no prompt in the repo mentioned food safety at all.** The only
 * constraint on a doneness instruction was `TEMPERATURE_RULES`, which governs
 * which UNIT a number is written in and says nothing about the number. So
 * nothing stopped a generated recipe from finishing chicken on a visual cue
 * alone, giving a slow-cooker method for dried kidney beans, or building a
 * hollandaise on raw eggs with no mention of pasteurisation.
 *
 * ## Why this is not in `read-recipe-from-image`
 *
 * That prompt is the fifth consumer of the shared rule blocks and is
 * deliberately NOT a consumer of this one. Import is TRANSCRIPTION: the cook
 * photographed a page out of their own book, the row is written with
 * `created_by` set and is private to them, and the job is to reproduce what is
 * on the page. A rule telling the model to raise a temperature there would
 * silently rewrite somebody's grandmother's recipe and present the edit as the
 * original — which is a worse failure than the one it prevents, because the
 * cook has no way to see it happened. Authoring owes a duty of care; a
 * transcriber owes fidelity.
 *
 * ## Why it overrides the cook
 *
 * `modify-recipe` and `escalate-difficulty` take a free-text instruction and
 * rewrite the method around it. "Make it quicker" is the case that matters: the
 * cook time on a chicken IS the safety margin, and a model asked to compress it
 * has no reason not to. So the block opens by saying it outranks the
 * instruction, and those two prompts are exactly why that sentence exists.
 *
 * ## Scope: the floor, not a syllabus
 *
 * Five hazards, chosen because each is common in the dishes this app actually
 * generates AND has a specific, checkable instruction that removes it.
 *
 * **Two of them offer the model a CHOICE of mitigation, and that is not
 * softness.** Dried kidney beans may be hard-boiled or simply tinned; raw egg
 * may be cooked to 71°C or bought pasteurised. Both alternatives are genuinely
 * safe, and a rule with one route makes the model pick between obeying this
 * block and obeying something else. The raw-egg clause is written the way it is
 * because the first draft demanded "pasteurised eggs" in the INGREDIENT LIST,
 * which contradicts three older rules in `generate-recipe` — use only the given
 * ingredients, use their exact names, put qualifiers in "comment" — and those
 * exist because ingredient names are matched against the catalogue. The model
 * resolved the contradiction by obeying the older rules, which is correct, and
 * `food-safety.eval.ts` scored it as an unsafe recipe: 0/2 on Eggs Benedict
 * while every other dish passed. **A safety rule that fights the pipeline
 * loses, silently.** Every
 * line has to survive being read by somebody cooking a weeknight dinner — a
 * recipe that lectures is one people stop reading, which costs more safety than
 * it buys. Deliberately absent: allergen warnings (the blacklist and the
 * dietary tags are the app's answer, and a generated warning would be a claim
 * we cannot stand behind), and anything needing a judgement about the cook's
 * own kitchen.
 *
 * ## What it measures at
 *
 * `food-safety.eval.ts`, five dishes chosen to trigger one clause each, three
 * runs apiece against gpt-4.1:
 *
 * | | hazard removed | safety mentions per step |
 * | --- | --- | --- |
 * | without this block | **3/15** | 10% |
 * | with it | **13/15** | 17% |
 *
 * The second column is the cost side and it is the reassuring one: the block
 * roughly doubles how often a step mentions a temperature, which is what it is
 * for, rather than turning every step into a warning. Roast chicken, burgers,
 * chicken liver parfait and the kidney beans all pass 3/3.
 *
 * **The known weak case is hollandaise, at 1/3.** It is the only dish here
 * whose hazard sits in a sub-preparation rather than in the main protein, and
 * the model has a strong prior for how the sauce is written — "whisk until it
 * ribbons" is a texture cue that reads like a doneness test. Rewording the
 * clause to name that substitution took it from 0/3 to 1/3; a further pass is
 * not worth fitting to a three-run sample, which is the mistake
 * `step-structure.eval.ts` warns about in its own footer. If this is worth
 * closing properly, the lever is a dish-shaped one — the raw-egg preparations
 * are a short list — not another sentence here.
 *
 * Treat all of it as n=3. It is enough to show the block works and not enough
 * to rank two wordings of it.
 */
export const FOOD_SAFETY_RULES = `## Food Safety
These rules OUTRANK every other instruction in this prompt, including a request from the cook to make the dish faster, simpler, harder or different. Never lower a cooking temperature, shorten a cooking time below the figures here, or drop a safety step to satisfy one.

- A step that FINISHES cooking poultry, minced or ground meat, sausages, burgers, a stuffed or rolled joint, or reheated food MUST state the safe internal temperature in its text, in Celsius. Use: poultry 74°C, minced meat / sausages / burgers 71°C, whole cuts of pork, beef or lamb 63°C followed by a 3 minute rest, fish 63°C, reheated food 74°C.
- For those foods, NEVER give a visual cue on its own. "Until the juices run clear" is not a doneness test. Write the cue AND the temperature.
- A dish that serves egg RAW or barely set — mayonnaise, aioli, hollandaise, mousse, tiramisu, an egg-thickened sauce finished off the heat — MUST remove the risk, and doing neither is not an option. Default: write the step so the egg mixture reaches 71°C and state that figure in the text — for a sauce whisked over simmering water, "until it thickens and reaches 71°C" replaces "until it ribbons", which is a texture cue and not a safety one. Only if the dish is never heated at all, mark the egg pasteurised instead: keep the ingredient's "name" exactly as given and put "pasteurised" in that ingredient's "comment", because the ingredient list is matched against a catalogue and names must not be rewritten.
- DRIED kidney or cannellini beans MUST be soaked, drained, and then boiled hard for at least 10 minutes before any longer, gentler cooking. Never give a slow-cooker method that brings dried kidney beans up slowly. Tinned beans are already safe and need none of this.
- Cooked rice and grains: if the recipe cools or stores them, say to cool within an hour, refrigerate, and reheat once only.
- Do NOT write a recipe whose method requires home canning or bottling of a low-acid food, curing or fermenting meat or fish, garlic or herbs stored in oil at room temperature, foraged wild mushrooms, or a plant part that is toxic as written (rhubarb leaves, raw elderberry, green or sprouted potato). If the dish asked for needs one of these, write the nearest safe version instead and say what you changed in the description.
- State an internal temperature only where you are sure of it. If unsure, describe the doneness cue and leave the number out rather than inventing one.`;
