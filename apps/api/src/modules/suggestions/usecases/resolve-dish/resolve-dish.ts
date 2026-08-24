import { createStreamHandler } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import { searchRecipeSuggestions } from "../../../recipes/services/search-recipe-suggestions";

/**
 * One named dish in, one openable id out.
 *
 * The recipe chat can now decide that a change makes a DIFFERENT dish —
 * béchamel plus cheese is a Mornay — and offer to write it. This is what that
 * offer resolves to when it is accepted: the client has a name and nothing
 * else, and needs to know whether to open a recipe, generate a suggestion, or
 * report that there is nothing to write.
 *
 * ## Why it is this endpoint and not `/suggestions/generate`
 *
 * Generation is the LAST thing it should do. `searchRecipeSuggestions` is the
 * chat tool's own resolver and already runs the whole ladder in order — exact
 * name, then signature similarity, then the ingredient lookup, then, only if
 * every one of those misses, a single generated suggestion behind the
 * notability gate and the cross-table dedup guard. Asking for a Mornay when
 * somebody has already cooked one must hand back *that* Mornay, not mint a
 * second row for a dish the catalogue already has, and none of that logic is
 * worth a second copy.
 *
 * `dish` and `query` are the SAME string here, deliberately. `dish` is the flag
 * that says "a specific dish was named", which is what makes the catalogue
 * stages demand a canonical name match instead of accepting the nearest
 * sibling — see `RecipeSuggestionInput.dish`. Without it, asking for a Mornay
 * would be answered with a Béchamel, which is precisely the confusion this
 * whole feature exists to undo.
 *
 * ## JSON, not SSE
 *
 * Every other generating endpoint streams, because it is filling a page in
 * front of the reader. This one produces a single id: there is nothing to
 * reveal progressively, and the screen waiting on it (`/recipes/new`) is a
 * skeleton that already knows the dish's name. The wait is a suggestion, not a
 * recipe — one model call plus the review, not the full method.
 */
const RequestSchema = z.object({
    dish: z.string().trim().min(1).describe("The dish's name, as a cook writes it"),
    /** Ingredients the caller will not eat; honoured only if a dish is generated. */
    blacklist: z.array(z.string()).optional(),
    /** Dietary tags a generated dish must satisfy. */
    dietaryRestrictions: z.array(z.string()).optional(),
    /** How involved a GENERATED dish should be. Catalogue hits ignore it. */
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

/**
 * What the client gets back.
 *
 * Declared, but note what declaring it does and does not do: `createStreamHandler`
 * reads this only to pick JSON error handling over streaming error handling — it
 * does not validate the payload on the way out. It is here as the contract for a
 * reader, and because the handler will not compile without one.
 */
const ResponseSchema = z.object({
    kind: z.enum(["recipe", "suggestion", "none"]),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    image: z.string().nullable().optional(),
    totalTimeMinutes: z.number().nullable().optional(),
    tags: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

export const resolveDish = createStreamHandler({
    route: "suggestions.resolve",
    requestSchema: RequestSchema,
    responseSchema: ResponseSchema,

    handler: async ({ body }) => {
        const result = await searchRecipeSuggestions(
            {
                query: body.dish,
                dish: body.dish,
                maxResults: 1,
                blacklist: body.blacklist,
                dietaryRestrictions: body.dietaryRestrictions,
                difficulty: body.difficulty,
            },
            {
                // A no-op, and required rather than decorative: the presence of
                // this callback is what selects stage 3's SINGLE-suggestion
                // path. Omit it and the multi-suggestion JSONL generator runs
                // instead, which writes a batch of dishes around the name and
                // returns whichever landed first — for a request that named one
                // dish exactly.
                onPartialSuggestion: () => undefined,
            }
        );

        const item = result.suggestions[0];

        if (!item) {
            // Nothing found and nothing written. Almost always the notability
            // gate refusing an invented name — the chat is told never to make
            // one up, and this is what happens when it does anyway. Reported as
            // a normal 200 with `kind: "none"` rather than an error, because
            // nothing failed: the answer is that this dish does not exist.
            return {
                type: "raw" as const,
                statusCode: 200,
                data: { kind: "none" as const },
            };
        }

        return {
            type: "raw" as const,
            statusCode: 200,
            data: {
                // The client routes on this and nothing else: a recipe is
                // opened, a suggestion is generated. `suggestion` covers both
                // an existing row and one just written — from the reader's side
                // they are the same thing, a dish with no method yet.
                kind:
                    item.source === "existing_recipe"
                        ? ("recipe" as const)
                        : ("suggestion" as const),
                id: item.id,
                name: item.name,
                description: item.description,
                difficulty: item.difficulty,
                image: item.image ?? null,
                totalTimeMinutes: item.totalTimeMinutes ?? null,
                tags: item.tags,
            },
        };
    },
});
