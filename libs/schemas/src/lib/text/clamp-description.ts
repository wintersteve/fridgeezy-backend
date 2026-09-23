/**
 * Length budgets for the description fields and the step headline.
 *
 * **NEITHER DESCRIPTION IS CLAMPED ANY MORE.** Both numbers are written into
 * the PROMPTS and nothing enforces them on the way in — the card gloss lost its
 * clamp first, the detail description on 2026-09-23, and both for the same
 * reason: a cut sentence is exactly the thing the limit existed to prevent.
 * "Crispy breaded chicken bites … and a…" is not a shorter description, it is a
 * broken one, and the recipe screen has no `numberOfLines` and a whole page to
 * wrap into, so nothing was being protected. Two of the 54 catalogue recipes
 * were stored mid-sentence like that.
 *
 * **If a model ever writes an essay here, shorten the PROMPT — do not put a
 * clamp back.** That is the same instruction {@link CARD_DESCRIPTION_MAX}
 * carries, and it has held.
 *
 * {@link clampToTitleLength} survives, and the reason it is different is that a
 * step headline is a LABEL: over-long, it is prose in a slot drawn on one line,
 * so a marked cut is the honest reading. A description is prose already.
 *
 * What the surviving clamp keeps from the original design: it is a
 * `.transform()` and deliberately NOT a `.max()`. These schemas parse a
 * streamed JSONL frame and a failed frame is dropped whole, so a headline three
 * characters long would cost the instruction it belongs to.
 */

/**
 * The card description's budget, used to write the PROMPTS — it is deliberately
 * not enforced on the way in.
 *
 * Card descriptions sit on ONE line of `bodySmall` (Poppins Regular 12px, 0.4
 * tracking) in the app's recipe card. Measured against the real font metrics,
 * that line holds ~32 characters on a 375pt device, ~34 on a 393pt one and ~36
 * in the 272pt-wide vertical card.
 *
 * A clamp used to enforce it and was removed on request: cutting a gloss at 34
 * produced exactly the thing it was meant to prevent — "Hot sour shrimp soup,
 * tomatoes" where "Hot sour shrimp soup" was the whole answer. The gloss is
 * short because the prompt asks for two to five words, not because something
 * truncates it afterwards. Ask for fewer words before reaching for a clamp.
 */
export const CARD_DESCRIPTION_MAX = 34;

/**
 * The recipe screen's description, used to write the PROMPTS — it is
 * deliberately not enforced on the way in.
 *
 * One sentence, because the prompts used to ask for "2-3 sentences" with no
 * bound at all, which filled the screen above the ingredients with copy nobody
 * reads. The number is what the prompt asks for; the sentence is short because
 * it was asked for short, not because anything cuts it afterwards. See the
 * header of this file before reaching for a clamp.
 */
export const DETAIL_DESCRIPTION_MAX = 160;

/**
 * A step's headline — "Blanch the pork ribs".
 *
 * The prompt asks for two to five words, which is the target; this is the
 * backstop for a model that writes a sentence instead. Forty characters holds
 * five comfortable words and is short enough that anything longer is a
 * different kind of thing rather than a long example of this one.
 *
 * Clamped rather than bounded for the reason at the top of this file: a step's
 * frame is dropped whole if it fails to parse, so an over-long headline would
 * cost the instruction it belongs to.
 */
export const STEP_TITLE_MAX = 40;

/** Trailing punctuation left dangling by a cut. */
const TRAILING_PUNCTUATION = /[\s,;:-]+$/;

/**
 * Cut at a word boundary and mark it, rather than mid-word ("...with fresh basil
 * and par"). A boundary found very early means one very long word, where the
 * hard cut is the better of two bad options.
 */
const clampToWord = (trimmed: string, max: number): string => {
    const cut = trimmed.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    const clamped = lastSpace > max / 3 ? cut.slice(0, lastSpace) : cut;

    return `${clamped.replace(TRAILING_PUNCTUATION, "")}…`;
};

/**
 * Clamp a step headline to {@link STEP_TITLE_MAX} at a word boundary.
 *
 * No sentence-boundary pass, unlike {@link clampToDetailLength}: a headline
 * that has run long is a model writing prose where a label was asked for, and
 * the first sentence of that prose is still prose. The word cut with its
 * ellipsis at least reads as truncated rather than as a title someone chose.
 */
export const clampToTitleLength = (value: string): string => {
    const trimmed = value.trim();

    return trimmed.length <= STEP_TITLE_MAX
        ? trimmed
        : clampToWord(trimmed, STEP_TITLE_MAX);
};
