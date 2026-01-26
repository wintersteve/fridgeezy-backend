import { Router } from "express";

import { ChatController } from "./chat.controller";

const router = Router();

router.post("/", ChatController.send);

export const ChatRoutes = router;
