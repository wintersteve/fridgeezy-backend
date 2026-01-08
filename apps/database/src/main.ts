import { generateDietaryTagEmbeddings } from "./scripts/generate-tag-embeddings";
import { config } from "dotenv";

config();

generateDietaryTagEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
