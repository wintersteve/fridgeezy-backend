import "dotenv/config";
import "reflect-metadata";

import { createApp } from "./create-app";

const PORT = parseInt(process.env.PORT ?? "8000", 10);

const app = createApp();

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  POST /suggestions  - Get recipe suggestions (SSE)`);
    console.log(`  POST /recipes      - Generate full recipe (SSE)`);
    console.log(`  POST /mcp          - MCP protocol endpoint`);
    console.log(`  GET  /health       - Health check`);
});
