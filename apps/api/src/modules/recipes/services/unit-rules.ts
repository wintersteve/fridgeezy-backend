/**
 * Which unit an ingredient is written in — shared by every prompt that AUTHORS
 * an ingredient list: `promote`, `generate-recipe`, `escalate-difficulty` and
 * `buildModifySystemPrompt` (modify, personalise, and the blacklist adaptation).
 *
 * Shared for the reason {@link TEMPERATURE_RULES} is: all four write ingredient
 * lines, and escalating or modifying a recipe rewrites the list wholesale — so a
 * rule living in three of them is a rule the fourth quietly undoes, one variant
 * at a time.
 *
 * ## The unit is how a cook checks themselves
 *
 * Nothing in the repo had ever said which unit to PREFER — the prompts listed
 * the approved abbreviations and left it there, and every worked example in all
 * five of them is `"quantity":100,"unit":"g"`. So grams became the path of least
 * resistance for anything weighable, and the catalogue filled up with amounts
 * like "50 g ginger".
 *
 * That is not wrong, it is uncheckable. A cook reading "500 g flour" can weigh
 * it, and the packet says 500 g too. A cook reading "50 g ginger" is holding a
 * knob of ginger and has no way to tell that the recipe is asking for about ten
 * centimetres of it — which is a lot. The unit's job is partly to let a mistake
 * be caught before it is made, and a weight can only do that for something the
 * kitchen actually weighs.
 *
 * ## Why this belongs in the prompt and not in the client
 *
 * `formatScaledAmount` in the app is the one place an amount becomes text, and
 * it deliberately converts only WITHIN a family (g<->kg, tsp<->tbsp) because
 * there is no fixed conversion from a weight to a piece. Fixing this at render
 * time would mean a curated grams-per-piece table sitting below that function
 * and disagreeing with the step prose and the shopping list, which read the
 * stored row. The unit is chosen once, at write time; this is where it happens.
 *
 * The count vocabulary this leans on is already seeded (`001_units.sql`:
 * pc, clove, slice, bunch, sprig, head, can, pkg, pinch, dash) and the client
 * already writes those on a half grid — "½ onion", "1½ cloves" — so nothing
 * downstream had to change for this rule to land.
 *
 * ## Deliberately NOT applied to import
 *
 * `read-recipe-from-image` transcribes a recipe somebody else wrote. A
 * preference rule there would silently rewrite the source's own amounts, which
 * is the one thing a transcription must not do — an imported recipe that
 * disagrees with the page it was read from is a bug, however much nicer the
 * unit reads.
 *
 * It is static, so it sits with the cacheable prefix. Keep it above the
 * per-request ingredient block in every prompt that has one.
 */
export const UNIT_CHOICE_RULE = `### Choosing the unit
The unit exists so the cook can CHECK the amount against what is in their hand. Pick the unit they can verify, not the one that is most precise.
- COUNT anything bought and handled as whole items, even when it could be weighed. Use its own count unit where one exists — "clove" for garlic, "bunch" for soft herbs (parsley, coriander, dill), "sprig" for woody ones (thyme, rosemary), "head" for lettuce, cabbage and cauliflower, "slice" for bread and bacon, "can" for tinned tomatoes, beans and coconut milk — and "pc" for everything else counted: ginger, chilli, spring onion, onion, carrot, celery stick, lemon, lime, egg, tortilla, bay leaf.
- WEIGH OR MEASURE what is poured, scooped, or cut from something larger: flour, sugar, rice, pasta, meat, fish, cheese, butter, potatoes, mushrooms, stock, cream, oil.
- SPOON the seasonings, never weigh them: salt, pepper, ground spices, baking powder, dried yeast, cornflour. Write "1 tsp cumin", never "2 g cumin". Use "pinch" or "dash" only for a genuine trace (saffron, chilli flakes to finish).
- Put the SIZE in "comment" whenever a counted item varies — that is what the field is for: {"name":"ginger","quantity":1,"unit":"pc","comment":"thumb-sized piece, peeled and grated"}, {"name":"chicken breast","quantity":2,"unit":"pc","comment":"about 400 g total"}. Never in the name.
- ONE unit per ingredient. Never give a second in parentheses ("2 pc (100 g)"); if the weight is worth stating it goes in "comment".
- REWRITING an existing recipe: apply this to the ingredients you ADD or change, and leave an untouched ingredient's unit exactly as it was given. A variant whose amounts are written differently from the recipe it came from reads as a second recipe rather than a version of one.
- THE TEST: could a cook confirm this amount without a scale? "50 g ginger" fails it — nobody weighs ginger, and nothing on the page tells them that is a 10 cm knob. "1 pc ginger, thumb-sized" passes and asks for the same thing.`;
