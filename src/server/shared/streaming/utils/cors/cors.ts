import { ServerResponse } from "node:http";

import { DEFAULT_CORS_HEADERS } from "../../constants";

export interface CorsConfig {
    origin?: string;
    methods?: string;
    headers?: string;
}

/**
 * Build CORS headers from configuration.
 * If no config is provided, returns DEFAULT_CORS_HEADERS.
 */
export function buildCorsHeaders(config?: CorsConfig): Record<string, string> {
    if (!config) {
        return { ...DEFAULT_CORS_HEADERS };
    }

    return {
        "Access-Control-Allow-Origin": config.origin || "*",
        "Access-Control-Allow-Methods": config.methods || "POST, OPTIONS",
        "Access-Control-Allow-Headers": config.headers || "Content-Type",
    };
}

/**
 * Handle CORS preflight (OPTIONS) request.
 * Sends 204 No Content response with CORS headers.
 */
export function handleCorsPrelight(
    res: ServerResponse,
    headers: Record<string, string> = { ...DEFAULT_CORS_HEADERS }
): void {
    res.writeHead(204, headers);
    res.end();
}
