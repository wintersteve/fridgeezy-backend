import { Request, Response, NextFunction } from "express";

import { synthesizeSpeech } from "./usecases/synthesize-speech";

export class SpeechController {
    static synthesize = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return synthesizeSpeech(req, res);
        } catch (err) {
            next(err);
        }
    };
}
