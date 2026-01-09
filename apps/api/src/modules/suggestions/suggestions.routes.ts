import {
    SuggestionGeneratorService,
    SuggestionsService,
} from "@fridgeezy/application";
import { Router } from "express";

import { container } from "../../container";

import { SuggestionsController } from "./suggestions.controller";
import { createGenerateSuggestionHandler } from "./use-cases/generate-suggestion";

export function createSuggestionsRoutes() {
    const router = Router();

    // Resolve services from DI container
    const suggestionsService = container.resolve(SuggestionsService);
    const generatorService = container.resolve(SuggestionGeneratorService);

    // Create the handler with injected dependencies
    const generateHandler = createGenerateSuggestionHandler(
        generatorService,
        suggestionsService
    );

    // Create controller with the handler
    const controller = new SuggestionsController(generateHandler);

    router.post("/generate", controller.generate);

    return router;
}
