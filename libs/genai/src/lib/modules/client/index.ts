// The BARE specifier, and the `/node` subpath is a trap worth naming.
//
// `@google/genai` lists its `browser` condition first in `exports`, and this
// library was being built with the web entry INLINED — where `vertexai`,
// `project` and `location` are documented as "ignored on browser runtimes", so
// a Vertex client silently became a key client and failed with "An API Key must
// be set when running in a browser". The fix for that is in `vite.config.mts`:
// the package is EXTERNAL, so each consumer resolves it under its own
// conditions. Verified afterwards that both do so correctly — Node's `require`
// gives `dist/node/index.cjs`, and jiti gives the node build too.
//
// Pinning `@google/genai/node` also appears to fix it and breaks the deploy:
// that subpath has no `require` condition, only `import`, so it is ESM-only and
// the CJS Lambda bundle dies with ERR_REQUIRE_ESM. `infra/build-artifact.sh`
// catches it, which is the only reason it did not ship.
import { GoogleGenAI } from "@google/genai";

/**
 * TWO clients, chosen per PURPOSE rather than by a global switch.
 *
 * ## Why not one
 *
 * This was a single client behind `GOOGLE_GENAI_USE_VERTEXAI`, and that flag
 * moved everything at once — images, text-to-speech, the command classifier.
 * Images are the whole reason Vertex is here (the Gemini API in AI Studio
 * cannot be paid for with Cloud credit, and Vertex can), but the TTS models
 * this library pins are NOT listed for Vertex, so a flag that moved them too
 * was one deploy away from silently breaking cook mode's read-aloud.
 *
 * So the two backends are selected by which env var is set, and they select
 * different traffic:
 *
 * - **`GOOGLE_API_KEY`** — the Gemini API in AI Studio. The default for
 *   everything, and the only path for speech.
 * - **`GOOGLE_CLOUD_PROJECT`** — a Vertex project. When present, IMAGE
 *   generation goes there; nothing else does.
 *
 * Set neither and nothing works; set both and you get the split above, which
 * is the arrangement this repo actually wants.
 *
 * ## Both are LAZY, and that is what makes two of them safe
 *
 * The old client was built at module scope and threw on a missing key. With two
 * of them that would mean a process configured for one backend throwing about
 * the other before it ran a line — the `operations/` scripts have no Vertex
 * credentials in CI, and the Lambda has no Cloud project at all. Built on first
 * use, each one is only ever required by the code that actually calls it.
 *
 * `apps/api/load-secrets` still checks `GOOGLE_API_KEY` up front and reports it
 * with the rest, so the deployed path keeps its early, legible failure.
 *
 * ## Vertex auth is left to google-auth-library
 *
 * No credentials are passed. The library resolves them in its own documented
 * order — `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account JSON,
 * then gcloud's application-default login, then an attached metadata server —
 * so one code path serves a laptop with gcloud, a laptop with a key file, and
 * anything running inside GCP.
 */
let apiKeyClient: GoogleGenAI | undefined;
let vertexClient: GoogleGenAI | undefined;

/**
 * The Gemini API client, from `GOOGLE_API_KEY`.
 *
 * Everything that is not image generation, and the only backend speech has.
 */
export const genai = (): GoogleGenAI => {
    if (!apiKeyClient) {
        const apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            throw new Error("Missing GOOGLE_API_KEY environment variable");
        }

        apiKeyClient = new GoogleGenAI({ apiKey });
    }

    return apiKeyClient;
};

/** Whether a Vertex project is configured at all. */
export const isVertexConfigured = (): boolean =>
    !!process.env.GOOGLE_CLOUD_PROJECT;

/**
 * The client IMAGE generation uses: Vertex when a project is configured,
 * otherwise the ordinary key client.
 *
 * Falling back rather than throwing is deliberate — an unset
 * `GOOGLE_CLOUD_PROJECT` is not a misconfiguration, it is the state every
 * environment was in before Vertex existed and the one the deployed Lambda is
 * in today.
 */
export const imageGenai = (): GoogleGenAI => {
    const project = process.env.GOOGLE_CLOUD_PROJECT;

    if (!project) return genai();

    if (!vertexClient) {
        vertexClient = new GoogleGenAI({
            vertexai: true,
            project,
            // `global` rather than a region: the Gemini 3.x image models are
            // served there for every project, where a regional endpoint turns
            // model availability into a per-region question whose failure is a
            // 404 naming the MODEL. Override only for data residency.
            location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
        });
    }

    return vertexClient;
};
