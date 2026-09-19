-- Pins `search_path` on the four SECURITY DEFINER functions that lacked one,
-- and revokes the two grants that were never used.
--
-- These are the whole of what the Supabase security advisor has to say about
-- this schema once the rest is read properly: RLS is enabled with policies on
-- every table in `public`, no policy grants `anon` anything profile-scoped, no
-- extension lives in `public`, and the six views the advisor calls
-- "SECURITY DEFINER" read catalogue tables that are world-readable by design —
-- the two that touch user data (`profile_pantry`, `dish_components`) were
-- already `security_invoker`.
--
-- ## This is defence in depth, not a hole being closed
--
-- A mutable `search_path` on a definer function is exploitable by a caller who
-- can CREATE an object that shadows a name the body resolves. No client role
-- here can: `anon`, `authenticated` and `service_role` all have `CREATE` on
-- `public` revoked, and none may create a schema, a role or a database. The two
-- trigger functions cannot even be invoked directly — Postgres answers
-- `trigger functions can only be called as triggers`.
--
-- It is still worth doing, for two reasons. `handle_new_user` and
-- `handle_new_profile` run on the highest-privilege path in the system — they
-- write `profiles` and `profile_settings` as the definer, on a signup that an
-- anonymous caller initiates — so the class is worth closing whether or not
-- today's roles can reach it. And the honest reason: a standing wall of amber
-- warnings is how a real finding gets scrolled past later. A clean advisor is
-- what makes the next one legible.
--
-- ## Why `public, pg_temp` is safe for all four
--
-- Every cross-schema reference in these bodies is already schema-qualified —
-- `auth.users` in `has_user` and `handle_new_user`, `public.profiles` and
-- `public.profile_settings` in the two triggers — and a qualified name does not
-- consult the path. `find_recipes` touches no extension function: the vector
-- columns it selects are never operated on (the embedding search lives in
-- `search_recipes`, which is not a definer function and is not touched here).
-- That last point is the one to re-check if this list ever grows, because the
-- failure mode is a runtime error inside a function that compiled fine — the
-- same trap `db reset --linked` hits when `vector(1536)` is resolved without
-- `extensions` on the path.
--
-- `pg_temp` is listed LAST deliberately. Left off the path entirely Postgres
-- puts it FIRST, which is the hijack this pin exists to prevent; last, a
-- temporary table cannot shadow anything.

alter function public.find_recipes(p_difficulty text, ingredients uuid[], tags uuid[], blacklist uuid[], limit_count integer, p_offset integer, p_pantry uuid[])
    set search_path = public, pg_temp;

alter function public.has_user(email character varying)
    set search_path = public, pg_temp;

alter function public.handle_new_user()
    set search_path = public, pg_temp;

alter function public.handle_new_profile()
    set search_path = public, pg_temp;

-- The triggers are fired BY the tables they hang off, as the definer; nobody
-- calls them, and a direct call is refused by Postgres anyway. The grant is
-- Supabase's default for any new function rather than a decision.
--
-- **FROM PUBLIC, and that is the half that does the work.** The ACL on these
-- reads `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`: the empty
-- grantee is PUBLIC, and `anon` holds EXECUTE through it rather than by a grant
-- of its own — so `revoke ... from anon, authenticated` alone changes the ACL
-- not at all and `has_function_privilege('anon', …)` still answers true.
-- Verified both ways rather than assumed.
--
-- This is the exact mirror of what `20260902000002` records, which is why both
-- lines are here: there, a `revoke ... from public` left behind grants made to
-- `anon` and `authenticated` DIRECTLY, and the shipped anon key kept the
-- ability to read any user's quota by id. One incident each way is the argument
-- for revoking from all three every time.
--
-- Revoking does not stop the triggers firing: a trigger's function is executed
-- by the system, and EXECUTE is checked when the trigger is CREATED, not when
-- it fires. `service_role` keeps its grant, which is the definer path the API
-- already uses.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;

notify pgrst, 'reload schema';
