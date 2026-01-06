import { Request, Response, NextFunction } from "express";

import { extractIngredients } from "./use-cases/extract-ingredients";

export class IngredientsController {
    extract = async (req: Request, res: Response, next: NextFunction) => {
        try {
            res.json(extractIngredients(req, res));
        } catch (err) {
            next(err);
        }
    };
}
