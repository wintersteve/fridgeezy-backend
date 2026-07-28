import { Request, Response, NextFunction } from "express";

import {
    generateRecipe,
    escalateDifficulty,
    composeRecipe,
    modifyRecipe,
    recipeChat,
} from "./usecases";

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

    static compose = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return composeRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };

    static modify = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return modifyRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };

    static chat = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return recipeChat(req, res);
        } catch (err) {
            next(err);
        }
    };
}
