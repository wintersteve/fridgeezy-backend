/**
 * Length limits for the two description fields, and the clamps that enforce
 * them.
 *
 * Enforced as `.transform()` and deliberately NOT as `.max()`: these schemas
 * parse a streamed JSONL frame, and a failed frame is dropped whole. A recipe
 * whose description ran three characters long would lose its prep time and cook
 * time with it. Clamping keeps the frame and shortens the text.
 *
 * The prompts ask for something comfortably under each limit, so a clamp firing
 * is the exception. These numbers are the backstop, not the target.
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
 * The detail screen's description card. One sentence — the prompts used to ask
 * for "2-3 sentences" with no bound at all, which filled the screen above the
 * ingredients with copy nobody reads.
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
 * Clamp a detail description to {@link DETAIL_DESCRIPTION_MAX}, preferring a
 * SENTENCE boundary.
 *
 * The overrun this exists for is a model writing two sentences where one was
 * asked for, and dropping the second one reads as finished prose. Only when
 * there is no sentence to end on does it fall back to a marked word-boundary
 * cut.
 */
export const clampToDetailLength = (value: string): string => {
    const trimmed = value.trim();

    if (trimmed.length <= DETAIL_DESCRIPTION_MAX) {
        return trimmed;
    }

    const cut = trimmed.slice(0, DETAIL_DESCRIPTION_MAX);
    const lastSentence = Math.max(
        cut.lastIndexOf(". "),
        cut.lastIndexOf("! "),
        cut.lastIndexOf("? ")
    );

    // A sentence that ends in the first third is not the description, it is a
    // fragment of it — keep the word-boundary cut instead.
    if (lastSentence > DETAIL_DESCRIPTION_MAX / 3) {
        return trimmed.slice(0, lastSentence + 1);
    }

    return clampToWord(trimmed, DETAIL_DESCRIPTION_MAX);
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
