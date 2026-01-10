import "dotenv/config";
import "reflect-metadata";

import { createMcpRouter, createRestRouter } from "./api/v1";
import { createExpressApp } from "./express-app";

const PORT = parseInt(process.env.PORT ?? "8000", 10);

const app = createExpressApp();

app.use("/rest", createRestRouter());

app.all("/mcp", createMcpRouter());

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  POST /suggestions  - Get recipe suggestions (SSE)`);
    console.log(`  POST /recipes      - Generate full recipe (SSE)`);
    console.log(`  POST /mcp          - MCP protocol endpoint`);
    console.log(`  GET  /health       - Health check`);
});
