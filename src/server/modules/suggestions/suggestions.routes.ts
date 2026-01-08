import { Router } from "express";

import { SuggestionsController } from "./suggestions.controller";

export function createSuggestionsRoutes() {
    const router = Router();

    const controller = new SuggestionsController();

    router.post("/generate", controller.generate);

    return router;
}
