import { Request, Response, NextFunction } from "express";

import { generateSuggestion } from "./usecases";

export class SuggestionsController {
    static generate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return generateSuggestion(req, res);
        } catch (err) {
            next(err);
        }
    };
}
