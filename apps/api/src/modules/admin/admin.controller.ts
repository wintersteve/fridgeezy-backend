import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
    deleteRecipe,
    deleteSuggestion,
    drawStepArt,
    drawTechniqueArt,
    getOverview,
    getRecipe,
    getStepArt,
    listCategories,
    listIngredients,
    listRecipes,
    listStepArtRecipes,
    listTechniques,
    listSuggestions,
    listTags,
    listUsers,
    regenerateImage,
    replaceRecipeSteps,
    setRecipeHidden,
    setSuggestionHidden,
    updateIngredient,
    updateRecipe,
    updateTag,
    updateUser,
} from "./usecases";

/**
 * Hand a rejected promise to Express instead of losing it.
 *
 * Every other controller in this codebase writes the same try/catch by hand
 * around each handler, which is fine at four routes and is eighteen copies
 * here. Express 5 forwards a rejected handler automatically, but this app is on
 * the Express 4 semantics its own middleware assumes, and an unhandled
 * rejection in Lambda is a request that never answers rather than a 500.
 */
const handle =
    (usecase: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res, next: NextFunction) => {
        usecase(req, res).catch(next);
    };

export class AdminController {
    static overview = handle(getOverview);

    static listRecipes = handle(listRecipes);
    static getRecipe = handle(getRecipe);
    static updateRecipe = handle(updateRecipe);
    static replaceRecipeSteps = handle(replaceRecipeSteps);
    static setRecipeHidden = handle(setRecipeHidden);
    static regenerateImage = handle(regenerateImage);
    static listStepArtRecipes = handle(listStepArtRecipes);
    static getStepArt = handle(getStepArt);
    static drawStepArt = handle(drawStepArt);

    static listTechniques = handle(listTechniques);
    static drawTechniqueArt = handle(drawTechniqueArt);
    static deleteRecipe = handle(deleteRecipe);

    static listSuggestions = handle(listSuggestions);
    static setSuggestionHidden = handle(setSuggestionHidden);
    static deleteSuggestion = handle(deleteSuggestion);

    static listIngredients = handle(listIngredients);
    static updateIngredient = handle(updateIngredient);
    static listCategories = handle(listCategories);

    static listTags = handle(listTags);
    static updateTag = handle(updateTag);

    static listUsers = handle(listUsers);
    static updateUser = handle(updateUser);
}
