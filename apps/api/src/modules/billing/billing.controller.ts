import { Request, Response, NextFunction } from "express";

import { revenuecatWebhook } from "./usecases";

export class BillingController {
    static revenuecat = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return await revenuecatWebhook(req, res);
        } catch (err) {
            next(err);
        }
    };
}
