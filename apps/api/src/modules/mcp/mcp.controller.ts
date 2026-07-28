import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";

import { createMcpServer, Session } from "./index";

const sessions = new Map<string, Session>();

const server = createMcpServer();

export class McpController {
    static async chat(req: Request, res: Response): Promise<void> {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        const existingSession = sessionId
            ? sessions.get(sessionId)
            : undefined;

        if (existingSession) {
            // Express req/res are compatible with IncomingMessage/ServerResponse
            await existingSession.transport.handleRequest(req as any, res as any);
        } else if (!sessionId && req.method === "POST") {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
            });

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
    }
}
