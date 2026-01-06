import { Request, Response, NextFunction } from "express";

import { generateSuggestion } from "./use-cases/generate-suggestion";

export class SuggestionsController {
    generate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            res.json(generateSuggestion(req, res));
        } catch (err) {
            next(err);
        }
    };
}
