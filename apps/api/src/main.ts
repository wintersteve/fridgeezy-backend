import "dotenv/config";
import "reflect-metadata";

import { createRestRouter } from "./api/v1";
import { createExpressApp } from "./express-app";

const PORT = parseInt(process.env.PORT ?? "8000", 10);

const app = createExpressApp();

app.use("/rest", createRestRouter());

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  POST /rest/suggestions/generate - Get recipe suggestions (SSE)`);
    console.log(`  POST /rest/recipes/generate     - Generate full recipe (SSE)`);
    console.log(`  POST /rest/chat                 - Chat (SSE)`);
    console.log(`  GET  /rest/health               - Health check`);
});
