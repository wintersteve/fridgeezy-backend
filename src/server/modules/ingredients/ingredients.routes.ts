import { Router } from "express";

import { IngredientsController } from "./ingredients.controller";

export function createIngredientsRoutes() {
    const router = Router();

    const controller = new IngredientsController();

    router.post("/extract", controller.extract);

    return router;
}
