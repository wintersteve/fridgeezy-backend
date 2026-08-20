import type { NextFunction, Request, Response } from "express";

import { forgetPrompt, forgetPrompts, listPromptHistory, savePrompt } from "./usecases";

export class PromptsController {
    static list = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await listPromptHistory(req, res);
        } catch (err) {
            next(err);
        }
    };

    static save = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await savePrompt(req, res);
        } catch (err) {
            next(err);
        }
    };

    static forgetAll = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await forgetPrompts(req, res);
        } catch (err) {
            next(err);
        }
    };

    static forgetOne = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await forgetPrompt(req, res);
        } catch (err) {
            next(err);
        }
    };
}
