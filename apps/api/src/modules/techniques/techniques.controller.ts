import { Request, Response, NextFunction } from "express";

import { illustrateTechnique } from "./usecases";

export class TechniquesController {
    static illustrate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return illustrateTechnique(req, res);
        } catch (err) {
            next(err);
        }
    };
}
