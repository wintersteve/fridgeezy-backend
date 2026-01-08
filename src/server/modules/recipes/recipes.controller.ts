import { Request, Response, NextFunction } from "express";

import { escalateDifficulty } from "./use-cases/escalate-difficulty";
import { generateRecipe } from "./use-cases/generate-recipe";

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
