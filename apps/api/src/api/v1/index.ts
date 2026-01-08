import { Router } from "express";

import { createChatRoutes } from "../../modules/chat";
import { createIngredientsRoutes } from "../../modules/ingredients";
import { createRecipesRoutes } from "../../modules/recipes";
import { createSuggestionsRoutes } from "../../modules/suggestions";

export function createApiRouter() {
    const router = Router();

    // All handlers use IncomingMessage/ServerResponse which Express provides
    router.use("/chat", createChatRoutes());

    router.use("/ingredients", createIngredientsRoutes());

    router.use("/suggestions", createSuggestionsRoutes());

    router.use("/recipes", createRecipesRoutes());

    router.get("/health", (_, res) => {
        res.json({ status: "ok" });
    });

    return router;
}
