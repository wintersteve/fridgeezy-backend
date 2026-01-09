import { Request, Response, NextFunction } from "express";

import { createGenerateSuggestionHandler } from "./use-cases/generate-suggestion";

export class SuggestionsController {
    constructor(
        private readonly generateHandler: ReturnType<
            typeof createGenerateSuggestionHandler
        >
    ) {}

    generate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            return this.generateHandler(req, res);
        } catch (err) {
            next(err);
        }
    };
}
