import "dotenv/config";

import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createApiRouter } from "./api/v1";
import { createExpressApp } from "./express-app";
import { createMcpServer, Session } from "./infrastructure/mcp";

const PORT = parseInt(process.env.PORT ?? "8000", 10);

const sessions = new Map<string, Session>();

// Create Express app
const app = createExpressApp();
const apiRouter = createApiRouter();

// Mount API routes
app.use("/rest", apiRouter);

// MCP endpoint with special handling for StreamableHTTPServerTransport
app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        // Express req/res are compatible with IncomingMessage/ServerResponse
        await session.transport.handleRequest(req as any, res as any);
    } else if (!sessionId && req.method === "POST") {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });

        const server = createMcpServer();
        await server.connect(transport);

        transport.onclose = () => {
            if (transport.sessionId) {
                sessions.delete(transport.sessionId);
            }
        };

        await transport.handleRequest(req as any, res as any);

        if (transport.sessionId) {
            sessions.set(transport.sessionId, { server, transport });
        }
    } else {
        res.status(400).json({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "Bad Request: No valid session",
            },
            id: null,
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(
        `  POST /chat                     - Conversational interface (SSE streaming)`
    );
    console.log(
        `  POST /suggestions              - Get recipe suggestions (SSE)`
    );
    console.log(
        `  POST /recipe                   - Generate full recipe (SSE)`
    );
    console.log(
        `  POST /escalate-difficulty      - Escalate recipe difficulty (SSE)`
    );
    console.log(
        `  POST /extract-ingredients      - Extract ingredients from image`
    );
    console.log(
        `  POST /generate-category-image  - Generate and upload category image`
    );
    console.log(`  POST /mcp                      - MCP protocol endpoint`);
    console.log(`  GET  /health                   - Health check`);
});
