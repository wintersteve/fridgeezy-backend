import { Router } from "express";

import { McpController } from "./mcp.controller";

const router = Router();

router.post("/chat", McpController.chat);

export const McpRoutes = router;
