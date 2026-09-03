import { Router } from "express";

import { requireQuota } from "../../middleware/require-quota";

import { ChatController } from "./chat.controller";

const router = Router();

router.post("/", requireQuota("questions"), ChatController.send);

export const ChatRoutes = router;
