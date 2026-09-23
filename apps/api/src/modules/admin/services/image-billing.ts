import type { ImageBillingPath } from "@fridgeezy/admin-contract";
import { isVertexConfigured } from "@fridgeezy/genai";

/**
 * Which Google budget an image render will be billed to.
 *
 * Read from the environment at CALL time rather than cached, matching
 * `imageGenai()` itself — that function chooses its client the same way on
 * every call, so anything that cached the answer here could report a path the
 * next render does not take.
 *
 * It asks `@fridgeezy/genai` rather than testing the variable itself. The rule
 * "a project means Vertex" belongs to the client that acts on it, and a second
 * copy here would be a console that confidently names the wrong account the
 * day that rule changes.
 */
export const imageBillingPath = (): ImageBillingPath => ({
    vertex: isVertexConfigured(),
    project: process.env.GOOGLE_CLOUD_PROJECT ?? null,
    location: isVertexConfigured()
        ? (process.env.GOOGLE_CLOUD_LOCATION ?? "global")
        : null,
});
