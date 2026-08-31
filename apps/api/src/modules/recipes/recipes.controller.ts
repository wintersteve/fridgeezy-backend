import { Request, Response, NextFunction } from "express";

import {
    generateRecipe,
    escalateDifficulty,
    composeRecipe,
    adaptRecipe,
    modifyRecipe,
    personaliseRecipe,
    importRecipe,
    recipeChat,
    shareRecipe,
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

    static adapt = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return adaptRecipe(req, res);
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

    static personalise = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return personaliseRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };

    static import = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return importRecipe(req, res);
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

    /**
     * The only GET on this router, and the only route that answers with HTML
     * rather than SSE — it is fetched by link-preview crawlers, not the app.
     */
    static share = async (req: Request, res: Response, next: NextFunction) => {
        try {
            return await shareRecipe(req, res);
        } catch (err) {
            next(err);
        }
    };
}
