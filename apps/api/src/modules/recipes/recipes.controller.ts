import { Request, Response, NextFunction } from "express";

import { generateRecipe, escalateDifficulty, adjustServings } from "./usecases";

export class RecipesController {
    static generate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return generateRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };

    static escalate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return escalateDifficulty(req, res);
        } catch (err) {
            next(err);
        }
    };

    static adjustServings = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return adjustServings(req, res);
        } catch (err) {
            next(err);
        }
    };
}
