import { Request, Response, NextFunction } from "express";

import { generateSuggestion, promoteSuggestion } from "./usecases";

export class SuggestionsController {
    static generate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            console.log("test");
            return generateSuggestion(req, res);
        } catch (err) {
            console.log("error", err);
            next(err);
        }
    };

    static promote = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return promoteSuggestion(req, res);
        } catch (err) {
            next(err);
        }
    };
}
