import type { Request, Response, NextFunction } from "express";

import { processChat } from "./usecases/process-chat/process-chat";

export class ChatController {
    static send = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            await processChat(req, res);
        } catch (err) {
            next(err);
        }
    };
}
