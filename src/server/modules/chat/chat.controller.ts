import { Request, Response, NextFunction } from "express";

import { chat } from "./use-cases/chat";

export class ChatController {
    create = async (req: Request, res: Response, next: NextFunction) => {
        try {
            return chat(req, res);
        } catch (err) {
            next(err);
        }
    };
}
