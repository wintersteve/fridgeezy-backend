import { Router } from "express";

import { IngredientsController } from "./ingredients.controller";

const router = Router();

router.post("/extract", IngredientsController.extract);

export const IngredientsRoutes = router;
