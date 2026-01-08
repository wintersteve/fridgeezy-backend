import { Router } from "express";

import { createChatRoutes } from "@/src/server/modules/chat";
import { createIngredientsRoutes } from "@/src/server/modules/ingredients";
import { createRecipesRoutes } from "@/src/server/modules/recipes";
import { createSuggestionsRoutes } from "@/src/server/modules/suggestions";

export function createApiRouter() {
    const router = Router();

    // All handlers use IncomingMessage/ServerResponse which Express provides
    router.use("/chat", createChatRoutes());

    router.use("/ingredients", createIngredientsRoutes());

    router.use("/suggestions", createSuggestionsRoutes());

    router.use("/recipes", createRecipesRoutes());

    router.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    return router;
}
