import { Router } from "express";

import { RecipesController } from "./recipes.controller";

const router = Router();

router.post("/generate", RecipesController.generate);
router.post("/difficulty/escalate", RecipesController.escalate);
router.post("/modify", RecipesController.modify);
router.post("/:recipeId/compose", RecipesController.compose);
router.post("/:recipeId/chat", RecipesController.chat);
router.get("/:recipeId/share", RecipesController.share);

export const RecipesRoutes = router;
