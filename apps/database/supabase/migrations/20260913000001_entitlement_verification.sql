-- When the entitlement row was last checked against RevenueCat itself.
--
-- ## The hole this closes
--
-- `profile_entitlements` has only ever had ONE writer: the RevenueCat webhook.
-- `20260806000004` argued that deriving activity from `expires_at` means a
-- missed EXPIRATION costs "a late revocation rather than an indefinite free
-- ride, and the row self-heals when the clock passes `expires_at`". That is
-- true, and it is only half the story — it self-heals at the EXPIRY the last
-- event happened to carry. Nothing re-asks. So a row whose expiry is wrong is
-- wrong until that date, however far away it is, and every reader downstream
-- (`entitlement_is_active`, and through it `ai_quota_status`) states it as
-- fact.
--
-- Two ways that happens, and neither is exotic:
--
-- - **A refund, a transfer, or any event that never arrived.** RevenueCat
--   retries a non-2xx for hours and then stops; the row keeps whatever it last
--   heard.
-- - **Local development, where it is not a failure but the DESIGN.** RevenueCat
--   delivers webhooks to one URL — the deployed Function URL — so a local stack
--   NEVER receives one. `infra/send-webhook-event.sh` fabricates the row
--   instead, defaulting to a 30-day expiry, and nothing can end it early. That
--   is how a device showing "no subscription" sits in front of a database
--   calling the same person a subscriber for a month, with the free quota
--   unenforced behind it.
--
-- ## Why a column rather than reusing `updated_at`
--
-- They answer different questions and the difference is the whole point of the
-- freshness window. `updated_at` is when the entitlement last CHANGED; this is
-- when we last confirmed it had not. Folding a verification into `updated_at`
-- would mean every check rewrote the timestamp that says when the subscription
-- moved, and "nothing has changed since March" would become unanswerable.
--
-- Null means never verified — every row written before this migration, and
-- every row a webhook writes from now on. It does NOT mean stale in the sense
-- of untrusted: a webhook event is first-hand news and needs no confirmation to
-- be applied. It means the API has not yet had occasion to re-ask, which is
-- what the reconciler's TTL reads.
alter table profile_entitlements
    add column if not exists verified_at timestamp with time zone;

comment on column profile_entitlements.verified_at is
    'When this row was last confirmed against the RevenueCat REST API. Null means never. Read by the API''s entitlement reconciler as its freshness window; NOT a substitute for updated_at, which records when the entitlement last changed.';
