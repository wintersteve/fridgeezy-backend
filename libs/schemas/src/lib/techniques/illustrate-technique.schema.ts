import { z } from "zod/v4";

/**
 * Ask for the painting of a cooking technique, generating it on a miss.
 *
 * The `action` is a canonical `cooking_actions.name` — resolved on the CLIENT,
 * which holds the whole action table with its aliases and inflections and so
 * can turn "what does dicing mean" into `dice` without a round trip. The server
 * checks the name against that same table anyway, and that check is what bounds
 * this route's lifetime spend: the vocabulary is closed at ~148 rows, so no
 * sequence of requests can cost more than the whole set once.
 */
export const IllustrateTechniqueRequestSchema = z.object({
    action: z
        .string()
        .min(2)
        .max(64)
        // Canonical names are lowercase words joined by underscores
        // (`set_aside`), never free text. Anything else is a caller that has
        // resolved the wrong thing, and rejecting it here is cheaper than a
        // table lookup that will miss.
        .regex(/^[a-z][a-z_]*$/, "not a canonical cooking action name"),
});

/**
 * `imageUrl` is a public storage URL, not bytes. The object is keyed on the
 * canonical action name, so one painting of grating serves every reader and
 * every recipe forever — the property that lets this route be free. `generated`
 * says whether this caller paid for it, which is the only thing the client
 * needs it for: a picture that had to be drawn arrives seconds late and gets a
 * fade, one that was already there should not.
 */
export const IllustrateTechniqueResponseSchema = z.object({
    action: z.string(),
    imageUrl: z.string(),
    caption: z.string(),
    generated: z.boolean(),
});

export type IllustrateTechniqueRequestDto = z.infer<
    typeof IllustrateTechniqueRequestSchema
>;

export type IllustrateTechniqueResponseDto = z.infer<
    typeof IllustrateTechniqueResponseSchema
>;
