/**
 * What `requireSupabaseUser` leaves on the request for later middleware.
 *
 * Only the id, not the whole Supabase `User`. Everything downstream needs is the
 * subject, and carrying the full object would put an email and user metadata on
 * an object that gets logged in places — plus it would make `apps/api` depend on
 * `@supabase/supabase-js` directly, which today it does not: it reaches Supabase
 * only through `@fridgeezy/supabase`.
 *
 * Optional because the type cannot express "set only after the auth middleware
 * ran". Read it as a contract: any handler mounted behind `requireSupabaseUser`
 * can rely on it, and nothing else should.
 */
declare global {
    namespace Express {
        interface Request {
            supabaseUserId?: string;
            /**
             * The admin's own `profiles.id`, left by `requireAdmin`.
             *
             * Separate from `supabaseUserId` because it is a different key:
             * `hidden_by` and every other actor column in the schema references
             * `profiles`, not `auth.users`. Resolving it in the gate means a
             * handler that stamps who did something does not look it up again,
             * and — more usefully — cannot look up the WRONG one by reading an
             * id out of the body.
             *
             * Read it only in a handler mounted behind `requireAdmin`.
             */
            adminProfileId?: string;
        }
    }
}

export {};
