import { Router } from "express";

import { RecipesController } from "./recipes.controller";

const router = Router();

router.post("/generate", RecipesController.generate);
router.post("/difficulty/escalate", RecipesController.escalate);
router.get("/:recipeId/adjust-servings", RecipesController.adjustServings);
router.post("/:recipeId/compose", RecipesController.compose);

export const RecipesRoutes = router;
