import { Router } from "express";

import { RecipesController } from "./recipes.controller";

const router = Router();

router.post("/generate", RecipesController.generate);
router.post("/difficulty/escalate", RecipesController.escalate);

export const RecipesRoutes = router;
