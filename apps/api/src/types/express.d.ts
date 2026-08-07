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
        }
    }
}

export {};
