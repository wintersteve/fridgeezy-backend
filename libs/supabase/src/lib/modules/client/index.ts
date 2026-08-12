import { Database } from "@fridgeezy/types";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");

if (!process.env.SUPABASE_ANON_KEY)
    throw new Error("Missing SUPABASE_ANON_KEY");

/**
 * The anon-key client. **Nothing in this repo should use it — reach for
 * {@link supabaseAdmin}.**
 *
 * It buys nothing here. Every caller is a trusted server process that already
 * holds the service-role key, and no user JWT is ever attached to this client,
 * so it acts as the bare `anon` role rather than as anybody in particular —
 * RLS without an identity to enforce against.
 *
 * What it cost: the repositories were split arbitrarily between the two
 * clients, and the anon half was writing — `persist_suggestion`, plus inserts
 * on ingredients, tags and suggestions. Those only ever worked because the
 * catalog tables carried `insert … using (true)` policies with no `TO` clause,
 * i.e. the same policies that let anyone holding the app's shipped anon key
 * write to the catalog. Tightening that (2026-08-12) meant moving every
 * repository to the service role first, or suggestion persistence would have
 * started failing in production.
 *
 * Kept only because dropping it makes `SUPABASE_ANON_KEY` an unused boot
 * requirement, which reaches into `env-local`/`env-remote`, `put-secrets.sh`
 * and the deployed function's parameters. Worth doing; not worth doing here.
 */
export const supabase = createClient<Database>(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient<Database>(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);
