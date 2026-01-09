import { SuggestionsService } from "@fridgeezy/application";
import { Router } from "express";

import { container } from "../../container";

import { SuggestionsController } from "./suggestions.controller";
import { createGenerateSuggestionHandler } from "./use-cases/generate-suggestion";

export function createSuggestionsRoutes() {
    const router = Router();

    // Resolve SuggestionsService from DI container
    const suggestionsService = container.resolve(SuggestionsService);

    // Create the handler with injected dependencies
    const generateHandler = createGenerateSuggestionHandler(suggestionsService);

    // Create controller with the handler
    const controller = new SuggestionsController(generateHandler);

    router.post("/generate", controller.generate);

    return router;
}
