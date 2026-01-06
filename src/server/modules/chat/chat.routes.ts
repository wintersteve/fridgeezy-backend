import { Router } from "express";

import { ChatController } from "./chat.controller";

export function createChatRoutes() {
    const router = Router();

    const controller = new ChatController();

    router.post("/", controller.create);

    return router;
}
