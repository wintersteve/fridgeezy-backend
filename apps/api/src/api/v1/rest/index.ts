import { Router } from "express";

import { ChatRoutes } from "../../../modules/chat";
import { IngredientsRoutes } from "../../../modules/ingredients";
import { RecipesRoutes } from "../../../modules/recipes";
import { SuggestionsRoutes } from "../../../modules/suggestions";

export function createRestRouter() {
    const router = Router();

    router.use("/ingredients", IngredientsRoutes);

    router.use("/suggestions", SuggestionsRoutes);

    router.use("/recipes", RecipesRoutes);

    router.use("/chat", ChatRoutes);

    router.get("/health", (_, res) => {
        res.json({ status: "ok" });
    });

    return router;
}
