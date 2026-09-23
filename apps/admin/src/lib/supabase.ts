import { createClient } from "@supabase/supabase-js";

/**
 * The console's Supabase client, used for ONE thing: signing in.
 *
 * It never reads data. Every row the console draws comes from
 * `/rest/admin/*`, which runs as the service role behind `requireAdmin` — so
 * this client holds the ANON key and, under RLS, can see nothing an ordinary
 * reader could not. That is deliberate: the anon key is in a JavaScript bundle
 * served from a public CloudFront distribution, and the whole design rests on
 * it being worth nothing to whoever finds it.
 *
 * What it produces is the access token the API verifies. The admin flag is
 * read server-side against that token and is never trusted from here.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    // Thrown at module scope rather than handled: with no Supabase there is no
    // sign-in and therefore no console, and a blank page with a console warning
    // is a worse way to learn that a build was made without its environment.
    throw new Error(
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time"
    );
}

export const supabase = createClient(url, anonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The app's own sign-in is a six-digit code rather than a link, so
        // there is no redirect to detect and nothing in this URL to consume.
        detectSessionInUrl: false,
    },
});

/**
 * A handle on the auth client, in development only.
 *
 * `import.meta.env.DEV` is replaced with a literal at build time and Vite
 * removes the branch, so this is absent from every deployed bundle — the same
 * guarantee `__DEV__` gives the mobile client.
 *
 * It exists because this console is entirely behind a sign-in, and local
 * sign-in needs a code that arrives by email: `[auth.email.smtp]` points the
 * local stack at Resend, which delivers only to the address that owns the key.
 * So anyone testing with a throwaway account — or on a machine that cannot
 * receive that mail — has no way in, and every UI change becomes unverifiable
 * in a browser.
 *
 * With this, a session minted out of band goes in through the SUPPORTED api:
 *
 *   await window.__supabase.auth.setSession({ access_token, refresh_token })
 *
 * `setSession` rather than writing localStorage by hand, which is what makes it
 * reliable: the client validates the tokens, fetches the user, writes storage
 * in whatever shape this version expects, and emits the state change the app is
 * listening for. Hand-written storage does none of that and fails silently.
 */
if (import.meta.env.DEV) {
    (window as unknown as { __supabase: typeof supabase }).__supabase = supabase;
}
