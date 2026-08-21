import { z } from "zod/v4";

/**
 * The difficulty scale: its order, its ranking, and what it is CALLED.
 *
 * The one copy both repos read, for the same reason `timeBandFor` next door is
 * — a value the API writes and the client draws needs one definition or the two
 * drift, and difficulty had drifted further than anything else in this codebase
 * before it was pulled together.
 *
 * ## The scale starts at the real dish
 *
 * `easy` is the standard version a competent home cook makes, `medium` a
 * chef-level interpretation, `hard` what a restaurant would send out. There is
 * no rung below the real dish. The generator-facing statement of this lives in
 * `DIFFICULTY_RULE` (`apps/api/.../suggestions/services/difficulty-rules.ts`);
 * this file holds the parts the CLIENT also needs, which is the ordering and the
 * words.
 */
export const DifficultySchema = z.enum(["easy", "medium", "hard"]);

export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * Position on the ladder, low to high.
 *
 * **These integers are load-bearing and are duplicated in SQL.**
 * `difficulty_preference_rank` (migration `20260803000001`) maps the same three
 * literals to the same 1/2/3, and {@link difficultyPreferenceRank} below
 * reproduces its formula. Changing either without the other makes a dish rank
 * one way when it arrives from `find_recipes` and another when it arrives from
 * text search — a divergence with no error and no symptom beyond a feed that
 * feels subtly wrong.
 *
 * A fourth level is therefore a THREE-place change: this map, the SQL function's
 * two `case` arms, and the enum itself.
 */
export const DIFFICULTY_ORDER: Record<Difficulty, number> = {
    easy: 1,
    medium: 2,
    hard: 3,
};

/**
 * What a dish's level is CALLED on screen.
 *
 * Deliberately not "Easy / Medium / Hard" any more. Those words described a
 * scale whose bottom rung was a beginner's simplification; on this scale
 * "Easy" would label the proper version of a dish and "Hard" a restaurant
 * plate, which is worse than unhelpful — it tells someone the standard recipe
 * is the dumbed-down one.
 *
 * ## ONE vocabulary, everywhere
 *
 * These words name the level wherever it appears — the card chip, the
 * difficulty sheet, the menu summary, chat prose, and the skill control in
 * Settings and onboarding. The stars survive as the ICON beside them, because
 * a picture of a scale is worth having and three stars read as a ladder at a
 * glance; what they no longer do is carry their own separate words.
 *
 * The app said this one thing FOUR ways before: Easy/Medium/Hard on chips,
 * "1-Star Chef" in Settings, bare numeric badges 1/2/3 in the settings list,
 * and Relaxed/Steady/Ambitious on menu summaries — with nothing mapping between
 * them, so a cook who set "2-Star Chef" had to work out for themselves that the
 * "Steady" menu of "Medium" dishes was the same fact told three more times.
 *
 * An intermediate version kept two sets, on the theory that the stars named the
 * COOK and these words named the DISH. That distinction is real but it is not
 * worth a second vocabulary: the cook picks a level to be served dishes at, so
 * the two scales were always the same scale seen from either end.
 *
 * ## All three name a KITCHEN, and that is the point
 *
 * Home, Restaurant, Fine Dining sit on one axis, so the ladder reads as a
 * ladder. An earlier set opened with "Classic", which named a VERSION of the
 * dish while the two above it named settings — two axes wearing one scale, and
 * the reader left to notice.
 *
 * They also mirror `DIFFICULTY_RULE`'s own wording, which describes the rungs as
 * "a competent home cook", "a good restaurant" and "a Michelin-starred kitchen".
 * That is deliberate: the label a cook reads and the instruction the model is
 * given should be recognisably the same claim, or the app is promising one thing
 * and generating another. Which is what this whole module exists to stop.
 *
 * **The top rung is NOT called Michelin, and that is a legal line rather than a
 * stylistic one.** The Guide is an actively enforced trademark operating in
 * exactly this domain — restaurant quality rating — so it is safe as a
 * DESCRIPTION handed to a model inside a prompt and not safe as a tier name
 * printed on a card. The prompt keeps it; the label does not. Nothing is lost:
 * the phrase is what steers the generation, and the generation is unchanged.
 */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    easy: "Home",
    medium: "Restaurant",
    hard: "Fine Dining",
};

/**
 * One line saying what the level means, for the point where someone CHOOSES one.
 *
 * These are the user-facing summary of `DIFFICULTY_RULE`'s three rungs and must
 * move whenever it does. Until this existed, nothing anywhere told a cook what a
 * level meant except the skill slider buried in Settings — the card chip had no
 * tooltip and the sheet's hint described the gesture rather than the levels.
 */
export const DIFFICULTY_BLURB: Record<Difficulty, string> = {
    easy: "The dish the way it is normally made",
    medium: "Made from scratch, with sharper technique",
    hard: "Every part in-house, composed to serve",
};

/**
 * The same three claims at length, for a surface with room to explain rather
 * than a row that has to fit one line — the skill control in Settings and in
 * onboarding, which is where someone commits to a level for every dish they
 * will be shown.
 *
 * Kept beside {@link DIFFICULTY_BLURB} rather than in the client, because the
 * short and long forms of one claim drifting apart is the same failure as the
 * label and the prompt drifting apart, only quieter. These lived in the
 * client's `SKILL_LEVELS` and described a beginner rung for some time after the
 * scale stopped having one.
 */
export const DIFFICULTY_DESCRIPTION: Record<Difficulty, string> = {
    easy: "The dish the way it is normally made. Real techniques, nothing simplified away.",
    medium:
        "Sharper technique, and the parts most recipes buy in made from scratch.",
    hard: "A restaurant plate at home: every component made in-house, timed to the minute, composed to serve.",
};

/**
 * How well a dish's level matches the cook's — LOWER is a better match.
 *
 * Distance from the preference, doubled, with the harder side taking the +1 so
 * that an equal-distance tie goes to the easier dish. No preference ranks
 * everything equally; an unrecognised or missing level sorts last (9) rather
 * than being dropped, because difficulty ORDERS and never narrows.
 *
 * **This is a mirror of `difficulty_preference_rank` in migration
 * `20260803000001` and must keep agreeing with it.** It cannot import from SQL,
 * so the guarantee is this comment plus the identical shape — the formula, the
 * doubling, the tie direction and the 9 are all copied deliberately rather than
 * re-derived.
 *
 * It lives here rather than in the client because both sides need it: the client
 * collapses recipe families with it after a text search, and the API reads the
 * same ordering out of `find_recipes`. It used to exist only in the client, with
 * a comment asking the reader to keep it in step with a migration in another
 * repository.
 */
export const difficultyPreferenceRank = (
    difficulty: string | null | undefined,
    preference: string | null | undefined
): number => {
    if (!preference) return 0;

    const level = DIFFICULTY_ORDER[difficulty as Difficulty];
    const preferred = DIFFICULTY_ORDER[preference as Difficulty];

    if (!level || !preferred) return 9;

    return Math.abs(level - preferred) * 2 + (level > preferred ? 1 : 0);
};

/**
 * Whether a transition is a climb or a descent — the DIRECTION, not the level.
 *
 * "This cook asked for `medium`" says nothing on its own: a restaurant recipe
 * simplified to chef-level and a classic pushed up to it are opposite
 * preferences that both record `medium`. Which way they reach, repeatedly, is
 * the durable fact, and it is what `profile_taste_signals` stores.
 *
 * Returns `undefined` when the levels are equal or either is unrecognised —
 * there is no direction to record, and a caller must not silently treat that as
 * "easier".
 */
export const difficultyDirection = (
    from: string | null | undefined,
    to: string | null | undefined
): "harder" | "easier" | undefined => {
    const a = DIFFICULTY_ORDER[from as Difficulty];
    const b = DIFFICULTY_ORDER[to as Difficulty];

    if (!a || !b || a === b) return undefined;

    return b > a ? "harder" : "easier";
};
