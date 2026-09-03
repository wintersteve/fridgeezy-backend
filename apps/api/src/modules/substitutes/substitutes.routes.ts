import { Router } from "express";

import { requireQuota } from "../../middleware/require-quota";

import { SubstitutesController } from "./substitutes.controller";

const router = Router();

// Answering a question about an ingredient, not writing a recipe.
router.post("/generate", requireQuota("questions"), SubstitutesController.generate);

export const SubstitutesRoutes = router;
