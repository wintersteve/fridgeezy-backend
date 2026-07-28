import { Router } from "express";

import { SuggestionsController } from "./suggestions.controller";

const router = Router();

router.post("/generate", SuggestionsController.generate);
router.post("/:id/promote", SuggestionsController.promote);

export const SuggestionsRoutes = router;
