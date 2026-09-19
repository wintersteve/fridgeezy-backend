import { z } from "zod/v4";

/**
 * Naming a dinner somebody has put together.
 *
 *   POST /recipes/:recipeId/menu/title — one short model call, one name back.
 *
 * ## Why it is a route at all
 *
 * Compose emits a `menu_title` frame, and while composing was the only way a
 * menu came into being that was the whole story. It is not: the pairing layer
 * fills most courses outright, so the common path to a saved menu retrieves
 * every dish and never opens a compose stream — and the heading fell back to
 * the main course's name, which is exactly what the title frame was introduced
 * to stop ("Coq au Vin" printed directly above a course row called "Coq au
 * Vin").
 *
 * `borrowMenuTitle` already answers this case for free by lending the name of a
 * real menu holding the same meal, and it only reaches inside the stream. This
 * is the other half, and the owner's call (2026-09-16) was to always name the
 * menu rather than name it only when one could be borrowed: a borrowed title
 * needs somebody to have composed that exact combination first, which for a
 * freshly-picked menu is usually nobody.
 */

/** One course of the meal being named. */
export const MenuTitleCourseSchema = z.object({
    /** `appetizer` · `main` · `side` · `dessert`. */
    courseType: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
});
export type MenuTitleCourseDto = z.infer<typeof MenuTitleCourseSchema>;

/**
 * The meal, in the order it is eaten.
 *
 * The MAIN is in here like any other course rather than being taken from the
 * path: the model is naming a sequence and reads it as one. The path's
 * `recipeId` still decides what the caller is entitled to ask about.
 *
 * Bounded at twelve because the prompt is the one place a caller controls text
 * on a route carrying no quota — see the route's own note. A menu is four
 * slots and a slot may hold two dishes, so twelve is past anything the build
 * sheet can produce.
 */
export const MenuTitleRequestSchema = z.object({
    courses: z.array(MenuTitleCourseSchema).min(1).max(12),
    /** Steers the origin half of the name. Omitted when nothing knows it. */
    cuisine: z.string().max(80).nullish(),
});

/**
 * **`title` is nullable, and null is an ORDINARY answer.**
 *
 * The model can be slow, refused, or hand back something too long to sit in a
 * navigation bar — all of which the service answers with null rather than an
 * error, because this rides on a commit the reader has already paid for. Every
 * caller must carry the main course's name as its own fallback; none of them
 * may treat an absent title as a failure, and none may wait on it to show the
 * menu.
 */
export const MenuTitleResponseSchema = z.object({
    title: z.string().min(1).nullable(),
});
export type MenuTitleResponseDto = z.infer<typeof MenuTitleResponseSchema>;
