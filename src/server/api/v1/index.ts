import { Router } from "express";

import { createChatRoutes } from "@/src/server/modules/chat";
import { createIngredientsRoutes } from "@/src/server/modules/ingredients";
import { createRecipesRoutes } from "@/src/server/modules/recipes";
import { createSuggestionsRoutes } from "@/src/server/modules/suggestions";

export function createApiRouter() {
    const router = Router();

    // All handlers use IncomingMessage/ServerResponse which Express provides
    router.post("/chat", createChatRoutes());
    router.post("/ingredients", createIngredientsRoutes());
    router.post("/suggestions", createSuggestionsRoutes());
    router.post("/recipe", createRecipesRoutes());

    router.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    return router;
}
