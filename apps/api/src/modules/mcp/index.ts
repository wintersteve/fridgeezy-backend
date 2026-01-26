import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getRecipeSuggestionsTool } from "./tools";

export interface Session {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
}

export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "fridgeezy-mcp",
        version: "1.0.0",
    });

    // const ideas = [
    //     "explain_step",
    //     "decrease_difficulty",
    //     "increase_difficulty",
    //     "generate_course",
    //     "generate_recipe",
    //     "search_recipes",
    //     "search_similar_recipes",
    //     "substitute_ingredients",
    // ];

    // Register GET_RECIPE_SUGGESTIONS tool
    server.registerTool(
        getRecipeSuggestionsTool.name,
        getRecipeSuggestionsTool.definition,
        getRecipeSuggestionsTool.handler
    );

    // server.registerTool(
    //     "GET_TAGS",
    //     {
    //         title: "Get Available Tags",
    //         description:
    //             "Fetch available recipe tags from the database. Returns dietary restriction tags (e.g., VEGAN, GLUTEN_FREE) and cuisine tags (e.g., ITALIAN, THAI).",
    //         inputSchema: TAGS_SCHEMA.INPUT,
    //         outputSchema: TAGS_SCHEMA.OUTPUT,
    //     },
    //     tagsCommand
    // );

    return server;
}

export { McpController } from "./mcp.controller";
