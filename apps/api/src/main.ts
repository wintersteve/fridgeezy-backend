import "dotenv/config";
import "reflect-metadata";

import { createApp } from "./create-app";
import { startupBanner } from "./startup-banner";

const PORT = parseInt(process.env.PORT ?? "8000", 10);

const app = createApp();

app.listen(PORT, "0.0.0.0", () => {
    console.log(startupBanner(PORT));
});
