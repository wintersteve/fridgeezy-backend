import { Router } from "express";

import { SuggestionsController } from "./suggestions.controller";

const router = Router();

router.post("/generate", SuggestionsController.generate);

export const SuggestionsRoutes = router;
