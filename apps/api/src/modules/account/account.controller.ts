import type { NextFunction, Request, Response } from "express";

import { deleteAccount } from "./usecases";

export class AccountController {
    static remove = async (req: Request, res: Response, next: NextFunction) => {
        try {
            await deleteAccount(req, res);
        } catch (err) {
            next(err);
        }
    };
}
