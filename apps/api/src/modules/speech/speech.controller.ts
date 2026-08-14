import { Request, Response, NextFunction } from "express";

import { interpretCommand } from "./usecases/interpret-command";
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

    static command = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            return interpretCommand(req, res);
        } catch (err) {
            next(err);
        }
    };
}
