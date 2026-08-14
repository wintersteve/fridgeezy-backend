import { Router } from "express";

import { SpeechController } from "./speech.controller";

const router = Router();

router.post("/synthesize", SpeechController.synthesize);

export const SpeechRoutes = router;
