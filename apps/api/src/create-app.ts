import type { Express } from "express";

import { createRestRouter } from "./api/v1";
import { createExpressApp } from "./express-app";

/**
 * Assembles the fully-routed app.
 *
 * Shared by the local server (`main.ts`) and the Lambda handler (`lambda.ts`) so
 * both serve exactly the same routes — a route added here shows up in both
 * without anyone remembering to mirror it.
 */
export function createApp(): Express {
    const app = createExpressApp();

    app.use("/rest", createRestRouter());

    return app;
}
