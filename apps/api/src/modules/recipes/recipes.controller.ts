import { Request, Response, NextFunction } from "express";

import { generateRecipe } from "./usecases";

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
            return next();
        } catch (err) {
            next(err);
        }
    };
}
