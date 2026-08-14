/**
 * What SHAPE a dish takes, as distinct from when it is served.
 *
 * Shared by all five generators — the batch feed
 * (`generate-suggestions-stream`), the single card (`stream-single-suggestion`),
 * menu composition (`generate-compose-suggestions`), promotion (`promote`) and
 * recipe generation (`generate-recipe`) — for the reason {@link DISH_NAME_RULE}
 * and {@link DISH_TOTAL_TIME_RULE} are.
 *
 * That reason was not hypothetical here. The rule landed on 2026-08-03 as four
 * byte-identical copies and was never added to the fifth, so chat's single
 * suggestion silently produced formless dishes for ten days while the other four
 * paths asked for a form. A rule enforced in some prompts and not the others is
 * worse than no rule: it makes the taxonomy look like a property of one endpoint
 * rather than of the catalog.
 *
 * ## Why this is not a course
 *
 * `course` answers "which slot in a meal does this fill", and its four values are
 * mutually exclusive — composition depends on that to request one appetizer, one
 * main and one dessert without contradiction. A soup is an appetizer in one
 * country and a main in another; a salad is a side or a meal. Form is orthogonal:
 * a dish has exactly one course AND may have one form. See
 * `20260803000008_tag_type_dish_form.sql`, which argues it at length.
 *
 * ## The optionality is load-bearing, in BOTH directions
 *
 * "Most dishes have no form" is true and must stay in the prompt — a plain plate
 * of food is the common case, and a taxonomy that forces every dish into one of
 * twenty shapes stops separating anything. But the hedge is also why the tag went
 * unemitted: it competes with a `tags` key description that never named it. Ask
 * for an optional field without listing it among the keys and the model drops it.
 * Both halves are needed, which is why {@link TAGS_KEY_RULE} exists.
 */
export const DISH_FORM_RULE = `AT MOST 1 dish form tag per recipe, and only when the dish clearly IS one: soup, stew, salad, sandwich, wrap, pizza, pasta, noodles, curry, stir fry, roast, bake, casserole, grill, pie, dumpling, rice dish, porridge, pancake, skewer. This is the SHAPE of the dish, not when it is served — a soup served first is still course "appetizer" and form "soup". Omit it entirely for a dish that is simply a plate of food; most dishes have no form.`;

/**
 * Whether this is a finished dish or a building block.
 *
 * ## Absence is the answer for a finished dish
 *
 * This rule used to demand EXACTLY ONE component tag and told the model to write
 * `dish` when nothing more specific fit. 87% of the catalogue therefore carried a
 * tag asserting that a recipe is a recipe — 269 rows saying nothing, padding the
 * `+N` counter on every card until the display view started filtering them out.
 *
 * Now a component tag is written ONLY for an actual component, so "is this a
 * building block?" is a plain EXISTS check rather than `!= 'dish'`. That also
 * makes the vocabulary honest: a list of components that does not itself contain
 * "dish". And it puts three of the four tag facets on one rule — form, component
 * and the derivable dietary claims are all absent-by-default, with cuisine the
 * only one a dish always carries.
 *
 * ## What still depends on this being right
 *
 * The tag is not decoration. `search-recipe-suggestions` calls it "the one
 * reliable way to tell 'a sauce' from 'a dish that has a sauce in it'", because
 * similarity search cannot: "sauce for apple strudel" scores highest against
 * Apple Strudel itself. Chat's component questions are answered from this tag, so
 * a sauce that arrives untagged is a sauce chat can no longer find.
 *
 * The failure directions are asymmetric, which is why the rule leans toward
 * omission: a missing tag on a genuine component costs one bad chat answer, while
 * a spurious one on an ordinary dish puts that dish into the results for "what
 * sauce goes with X" — visibly wrong to the user, not merely unhelpful.
 */
export const COMPONENT_RULE = `AT MOST 1 component tag, and ONLY when the recipe is a BUILDING BLOCK rather than something you would sit down and eat: sauce, stock, gravy, roux, slurry, spice blend, paste, rub, marinade, brine, cure, dough, batter, pastry, vinaigrette, dressing, custard, curd, caramel, crumb, pickle, jam, compote, syrup, glaze, icing, puree. Omit it ENTIRELY for a finished dish or meal — that is the common case and needs no tag at all. Béchamel is "sauce" and a roux is "roux"; Lasagne is a finished dish and gets nothing, even though it contains both.`;

/**
 * What a `Dish Form` line in the user's filter block MEANS.
 *
 * Only the two suggestion generators take that block — the recipe generators are
 * handed a dish that has already been chosen, so they have nothing to select.
 *
 * The tagging half of this is not redundant with {@link DISH_FORM_RULE}, and it
 * is the half that matters. A soup search that returns real soups WITHOUT the
 * `soup` tag never accumulates: the dishes persist untagged, the next soup search
 * finds an empty catalogue again, and the feed pays for generation on every visit
 * forever. That is exactly the loop this whole change was made to break, and it
 * would reopen silently — the cards look right, only the bill grows.
 */
export const DISH_FORM_FILTER_RULE = `When a "Dish Form" filter is given, EVERY dish you return must genuinely BE that form, and must carry it as its dish form tag. "Dish Form: soup" means suggest soups — not dishes served alongside a soup, and not a stew or a noodle bowl because they are close. If there are not enough well-known dishes of that form left for this request, return FEWER rather than stretching the definition.`;

/**
 * The `tags` key description, naming every type the array must carry.
 *
 * Every generator used to describe the key as "component, cuisine, and dietary
 * tags" — omitting BOTH course and dish form. Course survived the omission
 * because its own rule is emphatic ("EXACTLY 1 … Never omit it"); dish form,
 * correctly hedged as optional, did not. The rule and the key list have to agree,
 * or the more tentative of the two loses.
 */
export const TAGS_KEY_RULE = `tags (array of strings carrying the component, cuisine, course, dietary and — when the dish has one — dish form tags)`;
