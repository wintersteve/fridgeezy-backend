import { Router } from "express";

import { RecipesController } from "./recipes.controller";

export function createRecipesRoutes() {
    const router = Router();

    const controller = new RecipesController();

    router.post("/", controller.generate);
    router.post("/difficulty/escalate", controller.escalate);

    return router;
}
