import { Request, Response, NextFunction } from "express";

import { escalateDifficulty, generateRecipe } from "./use-cases";

export class RecipesController {
    generate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            return generateRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };

    escalate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            return escalateDifficulty(req, res);
        } catch (err) {
            next(err);
        }
    };
}
