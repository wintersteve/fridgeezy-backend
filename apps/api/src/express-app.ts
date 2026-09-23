import cors from "cors";
import express from "express";

export function createExpressApp() {
    const app = express();

    // Middleware
    app.use(
        cors({
            origin: "*",
            // DELETE is here for `/rest/prompts` — forgetting a slice of your own
            // prompt history. Like `Authorization` below, its absence is
            // invisible from the app (React Native's fetch does not preflight)
            // and fails only for a browser caller, so it has to be listed on the
            // way in rather than discovered later.
            // PATCH and PUT joined for the admin console (2026-09-22), which
            // is the first browser caller this API has had that edits rather
            // than streams. Same trap as `Authorization` below: React Native's
            // fetch does not preflight, so an unlisted method is invisible from
            // the app and fails only in a browser.
            methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
            // Authorization must be listed or a browser preflight strips it and
            // every request arrives looking unauthenticated. React Native's fetch
            // does not preflight, so this is invisible from the app and only bites
            // a browser caller — which is exactly why it is easy to miss.
            allowedHeaders: ["Content-Type", "Authorization"],
        })
        // `origin: "*"` is kept, including for /rest/admin. It reads alarming
        // and grants nothing: CORS decides which ORIGIN may read a response,
        // and every admin route demands a bearer token that lives in the
        // console's own storage, which the same-origin policy already keeps
        // from any other site. Narrowing it would be defence in depth over a
        // door that is already locked, at the cost of a list of hostnames to
        // keep in step with Terraform.
    );

    // Note: We don't use express.json() middleware here because the handlers
    // have their own body parsing logic that reads from the raw request stream.
    // Express's json() middleware would consume the stream before the handlers
    // can read it, causing requests to hang.

    // Request logging
    app.use((req, _, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });

    return app;
}
