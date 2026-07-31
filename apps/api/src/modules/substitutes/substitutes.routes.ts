import { Router } from "express";

import { SubstitutesController } from "./substitutes.controller";

const router = Router();

router.post("/generate", SubstitutesController.generate);

export const SubstitutesRoutes = router;
