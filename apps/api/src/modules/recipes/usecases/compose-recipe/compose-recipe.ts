import {
    ComposeRecipeRequestSchema,
    ComposeRecipeResultDtoSchema,
    ComposeRecipeProgressDtoSchema,
} from "@fridgeezy/schemas";
import {
    initSseStream,
    writeSseEvent,
    endSseStream,
} from "@fridgeezy/streaming-server";
import { Request, Response } from "express";

import {
    callerMayReadRecipe,
    fetchRecipe,
    generateComposeRecipes,
} from "../../services";

/**
 * Parse JSON body from request stream
 */
async function parseJsonBody(req: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

/**
 * Use-case handler for composing complementary courses for a recipe.
 * Streams results as they're generated (Server-Sent Events).
 */
export async function composeRecipe(
    req: Request,
    res: Response
): Promise<void> {
    try {
        // 1. Extract and validate recipe ID from params
        const recipeId = req.params.recipeId;

        if (!recipeId) {
            res.status(400).json({
                error: "Recipe ID is required",
            });
            return;
        }

        // 2. Parse and validate request body
        const rawBody = await parseJsonBody(req);
        const requestBody = ComposeRecipeRequestSchema.parse(rawBody);

        // 3. Fetch base recipe
        const baseRecipe = await fetchRecipe(recipeId);

        // Owned recipes are readable only by their owner, and this fetch runs as
        // the service role, past the RLS that enforces that elsewhere. Answered
        // as the same 404 a missing recipe gets, so the two are
        // indistinguishable to a caller probing ids.
        if (
            !baseRecipe ||
            !(await callerMayReadRecipe(baseRecipe.createdBy, req))
        ) {
            res.status(404).json({
                error: "Recipe not found",
                recipeId,
            });
            return;
        }

        // 4. Initialize SSE stream
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };
        initSseStream(res, corsHeaders);

        // 5. Generate and stream compose recipes
        try {
            const stream = generateComposeRecipes(baseRecipe, requestBody);

            for await (const item of stream) {
                // Validate each item before sending
                if (item.type === "result") {
                    const validated = ComposeRecipeResultDtoSchema.parse(item);
                    writeSseEvent(res, validated);
                } else if (item.type === "progress") {
                    const validated =
                        ComposeRecipeProgressDtoSchema.parse(item);
                    writeSseEvent(res, validated);
                }
            }

            // 6. End stream
            endSseStream(res);
        } catch (streamError) {
            // If error occurs during streaming, send error event and end stream
            writeSseEvent(res, {
                type: "error",
                message:
                    streamError instanceof Error
                        ? streamError.message
                        : "Unknown error",
            });
            endSseStream(res);
        }
    } catch (error) {
        // Handle validation errors and errors before streaming starts
        if (error instanceof Error && error.name === "ZodError") {
            res.status(400).json({
                error: "Invalid request parameters",
                details: error,
            });
        } else {
            res.status(500).json({
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }
}
