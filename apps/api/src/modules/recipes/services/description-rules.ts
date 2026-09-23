import { CARD_DESCRIPTION_MAX, DETAIL_DESCRIPTION_MAX } from "@fridgeezy/schemas";

/**
 * The `description` / `shortDescription` rules every header-emitting prompt
 * shares — `promote`, `generate-recipe`, `escalate-difficulty` and
 * `modify-recipe`.
 *
 * All four carried a byte-identical copy of this block, which is how the old
 * "max 60 characters" survived in four places at once.
 *
 * **THIS BLOCK IS NOW THE ONLY LENGTH LIMIT EITHER FIELD HAS.** Both clamps are
 * gone (see `clamp-description.ts`), so the constants interpolated here are
 * budgets the prompt ASKS for rather than headroom under a parser that would
 * cut. Both asks stay a little under their constant because that is what has
 * been producing one comfortable sentence and a two-to-five-word gloss; if a
 * model overruns, tighten the words asked for here — nothing downstream will
 * shorten the text, and a cut sentence was the whole reason the clamps went.
 */
export const HEADER_DESCRIPTION_RULES = `The two description fields are different lengths and both are required:
- "description": ONE sentence, max ${DETAIL_DESCRIPTION_MAX - 40} characters — what the dish IS, not a pitch. Never more than one sentence.
- "shortDescription": the card gloss. TWO TO FIVE WORDS, never more than ${CARD_DESCRIPTION_MAX - 2} characters including spaces — it is drawn on a single line that cannot wrap. Say what the dish is and STOP; shorter is better, and never pad it out towards the limit. A bare noun phrase, no verb, no closing period, and never the first words of "description" (e.g. "Crisp pork belly, pickled greens").`;
