import { z } from "zod/v4";

/**
 * Request schema for importing a recipe from a photograph — a cookbook page, a
 * screenshot, a handwritten card.
 *
 * ## The image fields are a deliberate copy of `/ingredients/extract`
 *
 * Same three keys, same names, same defaults. That endpoint is the only other
 * image-in route in this API and the client already has a working uploader for
 * it (`use-extract-ingredients`), so an import screen reuses the encode-and-post
 * half of that hook unchanged rather than inventing a second convention for the
 * same payload. If the shape ever needs to change, change it in both.
 *
 * `imageType: "url"` is carried through for the same reason it exists there —
 * the provider seam accepts either — but the client sends base64: a photo taken
 * on the device is not reachable at a URL.
 *
 * ## What is NOT here, and why
 *
 * **`servings`.** Every other recipe endpoint takes one, because it is writing a
 * recipe and can write it for any number. This one is *reading* a recipe that
 * already exists, and the page says who it serves. Accepting an override would
 * mean either storing quantities that contradict the stated yield, or rescaling
 * the printed amounts — a second, lossy transformation on top of an OCR pass
 * that is already the risky step. The yield comes off the page; rescaling is the
 * recipe screen's job, as it is for every other recipe.
 *
 * **`dietaryRestrictions` / `blacklist`.** They steer what a generator *writes*.
 * There is nothing to steer here: the recipe is whatever the page says. A user
 * importing a page with an ingredient they cannot eat wants the page, and can
 * then run `/recipes/modify` on the result — which is exactly the endpoint for
 * changing a recipe you already have.
 */
export const ImportRecipeRequestSchema = z.object({
    image: z
        .string()
        .min(1)
        .describe("Base64-encoded image data (no data: prefix) or an image URL"),
    imageType: z
        .enum(["base64", "url"])
        .default("base64")
        .describe("Whether `image` is base64-encoded bytes or a URL"),
    mimeType: z
        .enum(["image/jpeg", "image/png", "image/gif", "image/webp"])
        .default("image/jpeg")
        .describe("MIME type of the image (base64 only)"),
});

export type ImportRecipeRequest = z.infer<typeof ImportRecipeRequestSchema>;

/**
 * Why an import was refused, as a machine-readable code.
 *
 * The endpoint answers **422** with `{ error, code }` for both of these, before
 * the SSE stream is opened — so a client branches on the HTTP status first and
 * only reads this to choose the wording. Two codes rather than one because the
 * user's next action differs and is the whole point of telling them:
 *
 * - `not_a_recipe` — the photo is legible and is not a recipe (a plated dish, a
 *   shopping list, a person, a page of prose). Retrying the same photo cannot
 *   help. Point them at a different page.
 * - `unreadable` — there is plausibly a recipe there and it could not be read:
 *   blur, glare, a fold through the method, half the page out of frame. Another
 *   photo of the same page very likely works, which is what the client should
 *   offer.
 */
export const ImportRejectionCodeSchema = z.enum([
    "not_a_recipe",
    "unreadable",
]);

export type ImportRejectionCode = z.infer<typeof ImportRejectionCodeSchema>;

/**
 * The 422 body. `error` is human-readable and `code` is what to branch on.
 *
 * `error` is a bare string rather than an object because that is what every
 * other error response in this API returns, and the client's fetch wrappers
 * already read it; `code` is additive and older readers ignore it.
 */
export const ImportRecipeRejectionSchema = z.object({
    error: z.string(),
    code: ImportRejectionCodeSchema,
    /**
     * The model's own one-line account of what it saw, when it gave one.
     * Diagnostic — safe to show, but written for a log rather than for a user.
     */
    detail: z.string().optional(),
});

export type ImportRecipeRejection = z.infer<typeof ImportRecipeRejectionSchema>;
