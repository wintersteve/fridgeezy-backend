import { MenuTitleRequestSchema, MenuTitleResponseSchema } from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import type { Request } from "express";

import { generateMenuTitle, loadSeedRecipe } from "../../services";

const ROUTE = "recipes.menuTitle";

/**
 * Name a dinner somebody has just put together.
 *
 * One short model call, one name back, and null whenever the model gives
 * nothing usable — see `MenuTitleResponseSchema`, which says why null is an
 * ordinary answer rather than an error.
 *
 * ## Why this is not part of compose
 *
 * Compose emits a `menu_title` frame and did the whole job while composing was
 * the only way a menu came into being. Since the pairing layer began filling
 * courses outright, the common path retrieves every dish and opens no compose
 * stream — so `composedMenuTitle` returns null and the client falls back to the
 * MAIN COURSE'S NAME, which is the exact heading the frame was introduced to
 * replace. `borrowMenuTitle` closes the same hole from inside the stream and
 * cannot reach a caller that never enters it.
 *
 * ## The gate, which is an entitlement and deliberately not a quota
 *
 * The mount carries `requireEntitlement`, so only a caller who may compose gets
 * here at all. What it does NOT carry is `requireQuota`, and that is a decision
 * rather than an omission:
 *
 * - **The courses are already metered.** Every dish on the menu was either
 *   retrieved (free, and paid for by whoever generated the pairing set) or is
 *   being promoted right now through `/suggestions/:id/promote`, which spends a
 *   `recipes` unit each. The name is the last four words of an operation the
 *   reader is already paying for.
 * - **A unit is the wrong PRICE.** Compose spends one `recipes` unit for a
 *   whole dinner — "generous on purpose", as its own route says. Charging the
 *   same unit for a four-word label would make the heading cost as much as the
 *   meal.
 * - **A 402 here would be the worst possible failure.** The quota is checked at
 *   the door, before the handler runs, so a reader with a spent allowance would
 *   be refused a NAME mid-commit — after the dinner was recorded. The honest
 *   answer for that reader is the fallback heading they already get.
 *
 * What keeps it from being a free text channel is the request shape rather than
 * a gate: `MenuTitleRequestSchema` bounds the courses at twelve and each name at
 * 200 characters, the output is capped at forty tokens, and the prompt is fixed.
 */
export const menuTitle = createStreamHandler({
    route: ROUTE,
    requestSchema: MenuTitleRequestSchema,
    responseSchema: MenuTitleResponseSchema,

    handler: async ({ body, req }) => {
        const recipeId = (req as unknown as Request).params?.recipeId;
        const seed = await loadSeedRecipe(recipeId, req);

        if (seed.error) {
            return {
                type: "raw" as const,
                statusCode: seed.error.status,
                data: seed.error.body,
            };
        }

        const title = await generateMenuTitle({
            mainName: seed.recipe.name,
            courses: body.courses,
            cuisine: body.cuisine ?? null,
        });

        return {
            type: "raw" as const,
            statusCode: 200,
            data: { title },
        };
    },
});
