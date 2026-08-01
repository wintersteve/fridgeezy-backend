import type { Express } from "express";

import { createExpressApp } from "./express-app";
import { createRestRouter } from "./rest";

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
