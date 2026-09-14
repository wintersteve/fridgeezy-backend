import { Request, Response, NextFunction } from "express";

import { reconcileEntitlementRequest, revenuecatWebhook } from "./usecases";

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

    static reconcile = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return await reconcileEntitlementRequest(req, res);
        } catch (err) {
            next(err);
        }
    };
}
