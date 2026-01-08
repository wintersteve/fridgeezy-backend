import cors from "cors";
import express from "express";

export function createExpressApp() {
    const app = express();

    // Middleware
    app.use(
        cors({
            origin: "*",
            methods: ["GET", "POST", "OPTIONS"],
            allowedHeaders: ["Content-Type", "mcp-session-id"],
        })
    );

    // Note: We don't use express.json() middleware here because the handlers
    // (created with createMcpHandler) have their own body parsing logic that
    // reads from the raw request stream. Express's json() middleware would
    // consume the stream before the handlers can read it, causing requests to hang.

    // Request logging
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });

    return app;
}
