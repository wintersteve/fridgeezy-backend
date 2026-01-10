import { Request, Response, NextFunction } from "express";

import { extractIngredients } from "./usecases/extract-ingredients";

export class IngredientsController {
    static extract = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return extractIngredients(req, res);
        } catch (err) {
            next(err);
        }
    };
}
