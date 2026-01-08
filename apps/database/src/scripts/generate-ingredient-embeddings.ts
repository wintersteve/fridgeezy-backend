// import { config } from "dotenv";
//
// import { processEmbeddings } from "@/src/shared/openai";
// import { supabase } from "@/src/shared/supabase";
//
// config();
//
// async function generateIngredientEmbeddings() {
//     console.log("Fetching canonical ingredients from database...");
//
//     const { data, error } = await supabase
//         .from("tags")
//         .select("id, name, canonical_id, type")
//         .eq("type", "dietary")
//         .is("embedding", null)
//         .order("name");
//
//     if (error) {
//         throw new Error(`Failed to fetch ingredients: ${error.message}`);
//     }
//
//     if (!data?.length) return;
//
//     await processEmbeddings({
//         items: data,
//         columnExtractor: (item) => item.name,
//         onComplete: async (item, embedding) => {
//             await supabase
//                 .from("ingredients")
//                 .update({ embedding: JSON.stringify(embedding) })
//                 .eq("id", item.id);
//         },
//     });
// }
//
// // Execute the script
// generateIngredientEmbeddings()
//     .then(() => {
//         console.log("\nScript completed successfully!");
//         process.exit(0);
//     })
//     .catch((error) => {
//         console.error("\nScript failed:", error);
//         process.exit(1);
//     });
