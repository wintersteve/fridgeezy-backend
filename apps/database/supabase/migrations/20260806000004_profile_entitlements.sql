-- Subscription entitlement, written by the RevenueCat webhook.
--
-- Deliberately NOT a column on `profiles`. That table is client-writable — RLS
-- grants `users_update_own_profile`, and `useUpdateProfile` uses it on the
-- onboarding path — so a subscription flag living there would be settable by the
-- client it exists to check. Everything in this table is written by the service
-- role only: there is a select policy below and deliberately no insert, update
-- or delete policy, so RLS denies those to every client role.
--
-- `user_id` references auth.users directly rather than profiles.id because that
-- is what the webhook can resolve: the client configures RevenueCat with
-- `appUserID: user.data.id` (the Supabase auth user id), so `app_user_id` on an
-- event maps here with no lookup. Keep those two in step — changing the client's
-- appUserID silently orphans every future event.
create table if not exists profile_entitlements
(
    id             uuid primary key                  default gen_random_uuid(),
    user_id        uuid                     not null unique references auth.users (id) on delete cascade,
    -- The RevenueCat entitlement identifier that granted access, kept for
    -- debugging and for the day there is more than one tier.
    entitlement_id text,
    product_id     text,
    store          text,
    environment    text,
    -- Null means "no expiry known" — a lifetime purchase, or a grant that only
    -- ends when revoked. It does NOT mean expired; see the activity rule below.
    expires_at     timestamp with time zone,
    -- Set only when access is taken away before its expiry: a refund, or a
    -- transfer of the subscription to another account. A plain cancellation does
    -- NOT set this — the user keeps access until `expires_at`, which is what
    -- cancelling a subscription means on both stores.
    revoked_at     timestamp with time zone,
    -- Idempotency and ordering for the webhook. RevenueCat retries on any
    -- non-2xx and does not guarantee delivery order, so the handler ignores an
    -- event it has already seen and an event older than the one already applied.
    last_event_id  text,
    last_event_at  timestamp with time zone,
    created_at     timestamp with time zone not null default now(),
    updated_at     timestamp with time zone not null default now()
);

create index if not exists idx_profile_entitlements_user_id on profile_entitlements using btree (user_id);

-- Whether the row currently grants access.
--
-- Derived, never stored. A stored boolean goes stale the moment a subscription
-- lapses without a webhook arriving — and a missed EXPIRATION event is the
-- normal failure here, not an exotic one, because it is the one event no user
-- action triggers. Deriving it means a dropped event costs at most a late
-- revocation rather than an indefinite free ride, and the row self-heals when
-- the clock passes `expires_at`.
--
-- Not a generated column: `now()` is not immutable, so Postgres will not store
-- it. Callers that need it in SQL use this function; the API computes the same
-- rule in TypeScript (`isEntitlementActive`). Those two must agree.
create or replace function public.entitlement_is_active(p_user_id uuid)
    returns boolean
    language sql
    stable
as
$function$
select exists (select 1
               from profile_entitlements e
               where e.user_id = p_user_id
                 and e.revoked_at is null
                 and (e.expires_at is null or e.expires_at > now()));
$function$;

alter table profile_entitlements enable row level security;

-- Readable by its owner so the client can reconcile against what the RevenueCat
-- SDK reports locally. Writes are service-role only, by omission: with RLS on
-- and no policy for insert/update/delete, those are denied to anon and
-- authenticated, and the service role bypasses RLS entirely.
create policy users_read_own_entitlement on profile_entitlements for select using ((auth.uid() = user_id));
