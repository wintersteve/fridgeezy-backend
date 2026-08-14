import { Router } from "express";

import { SpeechController } from "./speech.controller";

const router = Router();

router.post("/synthesize", SpeechController.synthesize);
router.post("/command", SpeechController.command);

export const SpeechRoutes = router;
