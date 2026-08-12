-- Catalog tables become READ-only to the app's keys; writes are service-role.
--
-- Every catalog policy was written as `using (true)` with no `TO` clause, which
-- in Postgres means `TO public` — and `public` includes `anon`. So the anon key
-- shipped inside the React Native binary could not merely read the catalog, it
-- could insert recipes, update tags, and update or delete recipe instructions.
-- Nothing in the app ever did; nothing stopped anyone else either.
--
-- This lands ahead of guest browsing (unauthenticated read-only use), which
-- does not create the exposure but does put a lot more clients on that key.
--
-- WHAT MADE THIS SAFE TO DO. The API's repositories were split arbitrarily
-- between the anon and service-role clients, and the anon half was writing —
-- `persist_suggestion`, plus inserts on ingredients, tags and suggestions. Those
-- writes were only legal *because* of the policies dropped below, so this
-- migration would have broken suggestion persistence in production had the
-- repositories not moved to `supabaseAdmin` first. They did, in the same change.
-- If you are reverting this, revert that too, in the other order.
--
-- Reads are unchanged and stay open to `anon`: the catalog is a shared,
-- unattributed corpus with no owner column, the share page already serves from
-- it unauthenticated, and guest browsing depends on it. The `TO` clause is now
-- written out rather than inherited, so the next reader does not have to know
-- what an omitted `TO` defaults to.

-- ---------------------------------------------------------------------------
-- Writes: drop. Service role has bypassrls, so every real writer is unaffected.
-- ---------------------------------------------------------------------------

drop policy if exists public_insert on tags;
drop policy if exists public_update on tags;
drop policy if exists public_insert on tag_aliases;

drop policy if exists public_insert on ingredients;
drop policy if exists public_insert on ingredient_aliases;

drop policy if exists public_insert on cooking_action_categories;
drop policy if exists public_insert on cooking_actions;
drop policy if exists public_insert on cooking_action_aliases;

drop policy if exists public_insert on recipes;
drop policy if exists public_insert on recipe_ingredients;
drop policy if exists public_insert on recipe_instructions;
drop policy if exists public_update on recipe_instructions;
drop policy if exists public_delete on recipe_instructions;
drop policy if exists public_insert on recipe_tags;
drop policy if exists public_delete on recipe_tags;

drop policy if exists public_insert on recipe_suggestions;
drop policy if exists public_update on recipe_suggestions;
drop policy if exists public_delete on recipe_suggestions;
drop policy if exists public_insert on recipe_suggestion_ingredients;
drop policy if exists public_update on recipe_suggestion_ingredients;
drop policy if exists public_delete on recipe_suggestion_ingredients;
drop policy if exists public_insert on recipe_suggestion_tags;
drop policy if exists public_delete on recipe_suggestion_tags;

-- ---------------------------------------------------------------------------
-- Reads: unchanged in effect, but state the roles instead of inheriting them.
-- ---------------------------------------------------------------------------

alter policy public_read on categories to anon, authenticated;
alter policy public_read on units to anon, authenticated;
alter policy public_read on tags to anon, authenticated;
alter policy public_read on tag_aliases to anon, authenticated;

alter policy public_read on ingredients to anon, authenticated;
alter policy public_read on ingredient_aliases to anon, authenticated;

alter policy public_read on cooking_action_categories to anon, authenticated;
alter policy public_read on cooking_actions to anon, authenticated;
alter policy public_read on cooking_action_aliases to anon, authenticated;

alter policy public_read on recipes to anon, authenticated;
alter policy public_read on recipe_ingredients to anon, authenticated;
alter policy public_read on recipe_instructions to anon, authenticated;
alter policy public_read on recipe_tags to anon, authenticated;

alter policy public_read on recipe_suggestions to anon, authenticated;
alter policy public_read on recipe_suggestion_ingredients to anon, authenticated;
alter policy public_read on recipe_suggestion_tags to anon, authenticated;

-- ---------------------------------------------------------------------------
-- dietary_rules never had RLS enabled at all.
-- ---------------------------------------------------------------------------
--
-- Created in 20260803000004 without `enable row level security`, so it has been
-- relying on nothing but table grants — which Supabase hands to `anon` and
-- `authenticated` by default. It is small, hand-curated policy data that decides
-- which dietary tags `find_recipes` will derive, so a write to it silently
-- changes what every user is told is vegan.
--
-- The functions that read it (`find_recipes`, `recipe_display_tags`,
-- `derive_recipe_dietary`) are all `security definer` and so unaffected by RLS;
-- the select policy is for the client's `useDietaryRules`, which reads the table
-- directly.
alter table dietary_rules enable row level security;

create policy public_read on dietary_rules for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- NOT DONE HERE: public.has_user(email)
-- ---------------------------------------------------------------------------
--
-- It is `security definer` over `auth.users` and reachable by `anon` through
-- PostgREST, so it answers "does this person have an account" to anyone holding
-- the shipped anon key — a user-enumeration oracle.
--
-- It is also load-bearing, which is why it survives this migration: the client's
-- `EmailScreen.handleContinue` calls it to decide whether to route to
-- `/(auth)/login/password` or `/(auth)/sign-up/password`. Revoking execute would
-- not harden the flow, it would remove email sign-in.
--
-- Closing it properly means changing that flow rather than the grant — one
-- password screen that lets the sign-in attempt decide, or an OTP/magic-link
-- flow, both of which are enumeration-safe by construction. That is a product
-- decision about the login experience, so it is recorded in TODOS.md instead of
-- being made here by a migration.
