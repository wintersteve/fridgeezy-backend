import { Router } from "express";

import { requireQuota } from "../../middleware/require-quota";

import { IngredientsController } from "./ingredients.controller";

const router = Router();

// A vision call over a fridge photograph — the `photos` bucket.
router.post("/extract", requireQuota("photos"), IngredientsController.extract);

export const IngredientsRoutes = router;
