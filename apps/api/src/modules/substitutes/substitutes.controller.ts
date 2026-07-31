import { Request, Response, NextFunction } from "express";

import { suggestSubstitutes } from "./usecases";

export class SubstitutesController {
    static generate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return suggestSubstitutes(req, res);
        } catch (err) {
            next(err);
        }
    };
}
