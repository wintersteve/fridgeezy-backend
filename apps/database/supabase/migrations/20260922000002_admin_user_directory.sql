-- ---------------------------------------------------------------------------
-- The one thing the admin console needs that PostgREST cannot reach.
--
-- `auth.users` is not in the exposed schema — deliberately, and it should stay
-- that way — so an email address is unreachable from the API's Supabase client
-- even holding the service role. `auth.admin.getUserById` reaches it one user
-- at a time, which is fifty round trips to draw one page of a directory.
--
-- ## Why this is narrow rather than a view
--
-- A view over `auth.users` would expose every column it selects to anything
-- that can read the view, and the interesting columns there are the ones that
-- must never leave the auth schema: `encrypted_password`, the recovery and
-- confirmation tokens, `raw_user_meta_data` (which carries whatever an OAuth
-- provider sent). This returns three fields, by id, for a caller that has
-- already proved they are an admin.
--
-- ## The guard is INSIDE the function, not on the grant
--
-- `is_admin()` is checked in the body rather than relying on who may execute.
-- SECURITY DEFINER means this runs as its owner whatever the caller's
-- privileges, so the grant alone would make the check a property of the grant
-- list — and a `grant execute ... to authenticated` added later by habit would
-- silently turn it into an email-address oracle for every signed-in user. In
-- the body, the rule travels with the function.
--
-- **The service role is exempt**, because that is how the API calls it: the
-- API has already run `requireAdmin` against the caller's own token, and the
-- service role has no `auth.uid()` for `is_admin()` to resolve.
--
-- That exemption is tested with `auth.role()` and NOT with `current_user`,
-- which is the trap this function was written wrong on first. Inside a
-- SECURITY DEFINER body `current_user` is the function's OWNER — `postgres` —
-- whoever called it, so the comparison is a constant that never matches and
-- the API is refused its own route. `auth.role()` reads the `role` claim out
-- of the request's JWT (`service_role` for the API's client, `authenticated`
-- for a browser session), which is the question actually being asked.
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_directory(p_user_ids uuid[])
    returns table
            (
                user_id        uuid,
                email          text,
                last_sign_in_at timestamptz,
                confirmed_at   timestamptz
            )
    language plpgsql
    stable
    security definer
    set search_path = public, auth, pg_temp
as $function$
begin
    -- Checked first because `is_admin()` reads `auth.uid()`, which is null on
    -- a service-role connection. See the header for why this is `auth.role()`
    -- and must not be `current_user`.
    if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'admin_user_directory: not an admin';
    end if;

    return query
        select u.id,
               u.email::text,
               u.last_sign_in_at,
               u.confirmed_at
        from auth.users u
        where u.id = any (p_user_ids);
end;
$function$;

comment on function public.admin_user_directory(uuid[]) is
    'Email and sign-in times for a set of auth users, for the admin console. SECURITY DEFINER because auth.users is not in the exposed schema; the admin check is in the body so it cannot be lost by a later grant.';

revoke all on function public.admin_user_directory(uuid[]) from public;
grant execute on function public.admin_user_directory(uuid[]) to authenticated, service_role;
