import { Router } from "express";

import { SuggestionsController } from "./suggestions.controller";

const router = Router();

router.post("/generate", SuggestionsController.generate);

/**
 * A dish BY NAME -> the id that opens it.
 *
 * One static segment, so it never competes with `/:id/promote` below however
 * the two are ordered — that one is two segments and this is one, and Express
 * never has to choose.
 */
router.post("/resolve", SuggestionsController.resolve);
router.post("/:id/promote", SuggestionsController.promote);

export const SuggestionsRoutes = router;
