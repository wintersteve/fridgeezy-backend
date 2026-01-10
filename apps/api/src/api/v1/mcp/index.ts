import { Router } from "express";

import { McpRoutes } from "../../../modules/mcp/mcp.routes";

export function createMcpRouter() {
    const router = Router();

    router.use("/chat", McpRoutes);

    return router;
}
