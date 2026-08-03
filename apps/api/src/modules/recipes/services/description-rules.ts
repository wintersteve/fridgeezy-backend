import { CARD_DESCRIPTION_MAX, DETAIL_DESCRIPTION_MAX } from "@fridgeezy/schemas";

/**
 * The `description` / `shortDescription` rules every header-emitting prompt
 * shares — `promote`, `generate-recipe`, `escalate-difficulty` and
 * `modify-recipe`.
 *
 * All four carried a byte-identical copy of this block, which is how the old
 * "max 60 characters" survived in four places at once. The limits are
 * interpolated from the same constants the schema clamps with, so a prompt can
 * no longer promise a length the parser then shortens.
 *
 * The numbers are lower than the clamps on purpose: the clamp is a backstop that
 * appends an ellipsis, and an ellipsis on a card is the truncation this is
 * trying to avoid.
 */
export const HEADER_DESCRIPTION_RULES = `The two description fields are different lengths and both are required:
- "description": ONE sentence, max ${DETAIL_DESCRIPTION_MAX - 40} characters — what the dish IS, not a pitch. Never more than one sentence.
- "shortDescription": the card gloss. TWO TO FIVE WORDS, never more than ${CARD_DESCRIPTION_MAX - 2} characters including spaces — it is drawn on a single line that cannot wrap. Say what the dish is and STOP; shorter is better, and never pad it out towards the limit. A bare noun phrase, no verb, no closing period, and never the first words of "description" (e.g. "Crisp pork belly, pickled greens").`;
