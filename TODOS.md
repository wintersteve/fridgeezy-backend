# TODOS

The repo's working list. **Completed items were removed on 2026-08-07** — this
file is what is left to do, not a record of what was done.

Two places hold the record instead, and neither is this file:

- **`CLAUDE.md`** holds the durable knowledge: architecture, the entitlement and
  share-route decisions, the embedding-dimension constraint, the art-direction
  rules. Anything a future change must not break belongs there, not here.
- **git history** holds the narrative — what was tried, measured, and rejected.
  `git log -p TODOS.md` recovers the full Lambda/Bedrock migration record,
  including every finding trimmed out of this rewrite.

What stays below is open work, plus the findings that still *bind* it.

---

# 1. RevenueCat go-live

**Status: both halves are built, nothing is switched on.** The server can record
and enforce a subscription; the client can sell one. What is missing is
configuration in three consoles and one deploy. See the step-by-step at the
bottom of this file — the checkboxes here are the summary.

- [ ] App Store Connect: paid-apps agreement, subscription group, two products.
- [ ] RevenueCat: entitlement, an offering **identified `default`**, packages,
      App Store shared secret.
- [ ] Webhook: URL + `Authorization` value, matched into `apps/api/.env`, then
      `put-secrets.sh` and a cold start.
- [ ] `REQUIRE_ENTITLEMENT=true`, then **delete the flag** and make the gate
      unconditional so it cannot end up off in production quietly.
- [ ] Sandbox purchase and restore, on a device, on a development build.

## Known gaps, deliberately shipped open

- [ ] **The purchase-to-webhook window.** A user is entitled on-device seconds
      before the webhook lands, so a fresh purchase can see one 402. Fix is a
      fallback read of RevenueCat's REST API on a miss, bounded to users with no
      active row so it costs nothing on the common path. Needs a sixth secret and
      is unmeasurable until real purchases exist.
- [ ] **`TRANSFER` is received and not applied** — logged at error level. The
      top-level `app_user_id` does not reliably identify which side of the
      transfer the event is about, so the generic path is a coin flip between
      revoking a payer and granting a non-payer. Happens when someone restores
      onto a second account: rare, not hypothetical. Do it from a real payload
      rather than from the docs.
- [ ] **Android is not configured at all.** `REVENUECAT_API_KEY` has an empty
      string for Android (`core/revenuecat/constants`), so none of this works
      there — silently, as a no-op rather than an error. Fine if iOS ships first.
- [x] **Decide what a 402 should *do* in the client.** Done 2026-08-12: it opens
      `/unlock`, the dismissible full-screen modal, via `useSSEStream` — one
      choke point covering every SSE feature. 401 got the same treatment and its
      own `SSEError` kind, because the app now opens without a session so a 401
      is usually a guest rather than a stale token.

      The old objection — that a redirect right after a real purchase sends a
      paying user to a paywall they cannot satisfy — is narrowed but not gone.
      The modal is **dismissible** (the onboarding wall it replaces was not), so
      the failure costs a tap rather than trapping anyone. Still fix the
      purchase-to-webhook window above.
- [ ] **A trial quota for signed-in users — the "let them try it" tier.**

      The open question is whether every auth-gated feature is also a paid one.
      **It should not be, and the split is already in `FEATURE_TIER`:** `save` and
      `personalize` are gated because the data needs an *owner*, not because it
      costs anything, and they must never become paid — saving is the retention
      mechanism, and charging for it charges for the reason people come back.
      Only the AI features carry marginal cost, so only they can sensibly be
      metered.

      That gives a three-and-a-half tier ladder: guest browses, a free **account**
      gets all the saving plus **N trial units** of chat / generate / compose, and
      a subscription lifts the cap.

      **Meter the account, not the guest.** A signed-in user has a row to count
      against, so the quota is a `profile_usage` table and a middleware — no
      anonymous-auth question, and nothing to farm by reinstalling. A *guest*
      quota is the hard one and is the reason the chat-quota idea is parked
      below: there is no per-guest identity to store a counter on, a client-side
      count resets on reinstall and is per-device, and each unit is a real LLM
      call from an unauthenticated caller. Doing it properly needs Supabase
      anonymous sign-in plus rate limiting plus App Attest / Play Integrity,
      because otherwise minting anonymous users mints free quota.

      It slots in cleanly: `requireEntitlement` is already attached **per route**,
      so a `requireQuota("generate")` sits in the same position, and the client
      already routes 402 to the unlock sheet — a quota exhaustion is just another
      402 with different copy. What it needs designing is the reset window
      (rolling vs calendar month), whether compose costs more units than chat
      given it generates several dishes, and what the sheet says when the cap is
      hit rather than when the tier is wrong.

- [ ] **A guest chat quota — parked, needs the above decided first.** "One free
      chat message" was proposed and deliberately not built: see why in the
      preceding item. `/rest/chat` opened to guests on a client-side counter is an
      open spend endpoint on an honour system.
- [ ] **The unlock modal's email path loses the user's place.** Apple, Google and
      Facebook sign in *inside* the modal, so `useFeatureAccess` re-evaluates and
      it advances to the subscription step or dismisses. "Continue with Email"
      pushes onto the auth stack and the modal unmounts, so the user lands back
      in the app and has to tap the feature again. Fixing it needs an intent
      recorded across the auth flow **and** a decision about what to do when a
      sign-*up* detours through the whole onboarding flow — re-presenting a
      paywall at the end of that is not obviously right. Deliberately not
      half-built.
- [ ] **`public.has_user(email)` is an unauthenticated user-enumeration oracle.**
      `security definer` over `auth.users`, reachable by `anon` through
      PostgREST, so anyone holding the shipped anon key can ask whether a given
      email has an account. It survived the 2026-08-12 RLS tightening because it
      is **load-bearing**: `EmailScreen.handleContinue` calls it to route between
      `/(auth)/login/password` and `/(auth)/sign-up/password`. Revoking execute
      does not harden the flow, it removes email sign-in. Closing it properly
      means changing the flow — one password screen that lets the sign-in attempt
      decide, or an OTP/magic-link flow, both enumeration-safe by construction.
      That is a product decision about login, not a migration.
- [ ] **Drop the anon Supabase client from `libs/supabase`.** Every repository
      moved to `supabaseAdmin` on 2026-08-12 (they had to, or the RLS tightening
      would have broken suggestion persistence), so the `supabase` export is now
      unused and carries a deprecation notice. Removing it makes
      `SUPABASE_ANON_KEY` an unused boot requirement, which reaches into
      `env-local`/`env-remote`, `put-secrets.sh` and the deployed function's
      parameters. Worth doing; not worth doing in that change.

---

# 2. Dietary tier — the monetisation bet

**A €14.99/month "cook confidently with an allergy or intolerance" tier.**
Modelled at **+72% revenue per install** against the €4.99 plan, and roughly a
third of that comes from *halved churn* rather than the higher price: a coeliac
does not cancel in a quiet month.

**Most of this is already built and switched off.** `20260803000003` /
`20260803000004` are the right architecture for a safety claim — properties
(`contains dairy`) rather than diets (`is vegan`), `dietary_rules` mapping diets
to forbidden properties as data, and three-valued logic that fails closed:
`dietary_classified_at IS NULL` means *nobody has looked*, and the views treat
that exactly like disqualifying. Halal/kosher and the quantitative diets are
deliberately excluded and honestly labelled as model-tagged instead.

- [ ] **Run the classifier. This is the whole foundation and it is one command.**
      **337 of 337 ingredients have `dietary_classified_at = NULL`**, so
      `recipe_dietary` and `recipe_suggestion_dietary` return nothing and every
      dietary filter silently falls through to `shouldUseAI`. The deterministic
      system is complete and inert.
      ```bash
      DIET_ONLY="soy sauce,gelatin,oat milk,honey,worcestershire sauce" \
        npx nx run @fridgeezy/database:classify-ingredient-diet   # dry run first
      DIET_APPLY=true npx nx run @fridgeezy/database:classify-ingredient-diet
      ```
      Check the scattered hard cases first — the script's own comment warns that
      a capped dry run otherwise only ever sees the letter A. Costs cents.
      **Worth doing regardless of the tier**: it makes the free plan's existing
      dietary filters work at all.
- [ ] **Close the generation gap — the main engineering work.** The deterministic
      rule protects `find_recipes` (catalogue search) only. The AI feed honours
      restrictions *in the prompt*, i.e. by model judgement, which is precisely
      what the tier promises to replace. Generated dishes already have their
      ingredients matched to catalogue rows by `matchIngredients`, so the same
      rule can be applied after the fact — suppress or badge any generated
      suggestion that does not provably clear the user's restrictions. Without
      this the tier's promise is false on its most-used surface.
- [ ] **Severity levels**: preference / intolerance / allergy. Today a restriction
      is one thing. An allergy should hard-block; a preference can show with a
      badge.
- [ ] **Surface "unknown" as its own state.** Never collapse unverified into safe
      *or* unsafe. "We can't verify this dish for you" is the honest answer and
      the data already models it.
- [ ] **Household sharing**: one coeliac in a house of four is the real scenario,
      so the strictest member's restrictions apply to shared suggestions. Pairs
      with the household plan below.

## Also: a household plan — the best return per hour on the list

**€7.99 for up to 5 people, modelled at +21% revenue per install for roughly a
day's work.** Food is a household activity and the app already has the concepts:
shared fridge, shopping lists, menus, collections. Apple Family Sharing does the
distribution, and the marginal serving cost of the second person is far below the
marginal revenue because they browse the same catalogue.

- [ ] Second RevenueCat product + package in the `default` offering. Nothing in
      the gate changes — it asks only whether *any* entitlement is active.
- [ ] Decide what "household" means in the data: a shared profile group, or a
      per-user entitlement flag that unlocks sharing. The former is a migration,
      the latter is not.
- [ ] **Validate the segment before building.** The 12%-of-payers assumption is
      mine, not measured. Add "managing a food allergy or intolerance?" to
      onboarding and count. Under ~5% and this is the wrong bet — a fortnight and
      one screen to find out.

## The safety boundary — non-negotiable

**Allergen safety derives only from `dietary_properties`. No LLM in the safety
path, ever.**

The argument is in this repo's own eval data: `GUTTED_DISHES` in
`dedup-authenticity.eval.ts` holds a "Ceviche de Mariscos" whose ingredients are
lime, onion, chili, sweet potato and corn — no seafood — scoring `canonical` at
**0.95**. The gate read the *name*. Apply that failure mode to "is this
gluten-free" and someone is hospitalised.

Cross-contamination is **out of scope and must be said so**: ingredient
properties cannot see a shared fryer or a "may contain traces" line. Ship the
tier with wording that it is a cooking aid, not medical advice.

---

# 3. Cost levers

Measured from the `[LLM]` logs, not estimated: a four-card suggestion batch costs
**~$0.022**, of which `authenticity.verify` is **77%**. A recipe image is $0.14 —
7× the token cost of the recipe it illustrates.

- [x] **Skip the authenticity call on an exact catalogue hit** (2026-08-07).
      `findKnownDish` runs before the review: two indexed lookups, no LLM and no
      embedding. A hit settles immediately with the existing recipe or suggestion;
      a miss falls through to the unchanged pipeline.
      **This does not undo the review-first ordering.** That fix was about running
      the review *concurrently* with dedup and awaiting it last, so every layer
      compared a non-canonical name. This is a sequential pre-check on an exact
      string match — it either answers definitively or defers, and nothing
      downstream ever sees a different name than it would have. Recipes are
      checked before suggestions inside it, for the same stale-row reason the main
      pipeline orders its layers that way.
      Deliberately does **not** catch a renamed dish (`Pain Aux Bananes`): that
      misses here and is renamed by the review exactly as before. The pre-check
      only skips work when the answer is already certain.
- [ ] **Measure what it actually saves.** The saving is entirely a function of
      catalogue hit rate, which is unknown — and the feed uses the catalogue as an
      *exclusion list*, so it actively asks for dishes it does not have. Count
      `findKnownDish` hits against total suggestions over a real session before
      claiming a number.
- [ ] **Decide on deferred image generation — I now think this is wrong.** It was
      pitched as "$0.14 per promoted-then-abandoned recipe is pure waste", but
      that contradicts the later finding that images are a **capital cost, not a
      running one**: generation short-circuits on a deterministic storage path, so
      each dish is drawn once, ever, for all users. An abandoned recipe still
      leaves the image for the next person. It is only waste for a dish nobody
      ever promotes again, and the prompt refuses obscure dishes, so that tail is
      bounded. Against that, deferring means the recipe screen shows
      `bowl-placeholder` instead of a dish photo — a visible downgrade on the
      app's best surface. **Recommend dropping this**; revisit only if the logs
      show a long tail of one-off dishes.

---

# 4. No per-user rate limiting

Authentication bounds *who* can spend, not *how much*. Once item 1 is live,
entitlement becomes the ceiling and this drops in priority — until then anyone
who can sign up can loop the feed, and `reserved_concurrent_executions`
(dev 5 / prod 50) caps concurrency rather than volume.

The Function URL is `AuthType: NONE` by design and cannot change (see CLAUDE.md),
so any limit has to live in the app, alongside `requireSupabaseUser` and
`requireEntitlement` in the `MOUNTS` loop.

---

# 5. Auth — email confirmation and social sign-in

Nothing here is started.

**The thing that makes both items confusing:** `supabase/config.toml` `[auth]`
configures the **local** stack only. The hosted project's auth is configured in
the Supabase dashboard and does *not* read this file, so a setting can be correct
locally and absent in production with nothing to flag the drift. (Newer CLI
versions can push config; this repo's pinned 2.72.2 predates relying on that.)
Treat every item below as two pieces of work — local `config.toml` and the
dashboard — until that changes.

## Email confirmations

`enable_confirmations = false` (`config.toml:203`). Sign-up returns a session
immediately with no verified email. That is right for local — there is no real
inbox, and anything sent lands in Mailpit on `:54324` — but it means the address
on an account is **unverified**, so password reset, transactional mail, account
recovery and support identity all rest on nothing.

- [ ] Turn confirmations on for the hosted project (dashboard).
- [ ] Configure SMTP — `[auth.email.smtp]` is commented out, and without a real
      sender, enabling confirmations locks people out rather than verifying them.
- [ ] Decide the local story: leaving it `false` locally is convenient, but then
      the confirmation flow is only ever exercised in production.
- [ ] Check the client handles the unconfirmed state — a sign-up that returns no
      session because confirmation is pending is a different branch from one that
      returns a session, and today only the second exists
      (`features/auth/screens/sign-up/password/password-screen.tsx`).

## OpenID Connect / social sign-in

`[auth.external.apple]`, `[auth.external.google]` and `[auth.external.facebook]`
all sit at `enabled = false` (`config.toml:299-325`); the client offers
email/password only.

- [ ] Pick the providers. **Apple is not optional if any other social login ships
      on iOS** — review requires Sign in with Apple alongside third-party
      sign-in, so "just add Google" is really "add Google and Apple".
- [ ] Provider setup: OAuth client IDs, secrets via env substitution
      (`secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`). Never in
      `config.toml`.
- [ ] Redirect handling. The app's scheme is `fridgeezy` (`app.json`), so the
      callback is `fridgeezy://…` and must be added to `additional_redirect_urls`
      locally **and** to the dashboard's allow-list. `site_url` is still the CLI
      default `http://127.0.0.1:3000`.
- [ ] `skip_nonce_check` — required for local Google sign-in. Local only, never
      in the hosted project.
- [ ] Account linking. `enable_manual_linking = false` today, so a user who signs
      up with email and later uses Google with the same address gets a **second
      account**, silently. Decide before shipping the first provider —
      retrofitting a merge across existing rows is far worse than choosing up
      front.
- [ ] Client UI + `signInWithOAuth`, which needs an in-app browser session rather
      than the current password screens.

---

# 6. Smaller, but each one is user-visible

- [ ] **No crash reporting in production.** `EXPO_PUBLIC_SENTRY_DSN` is unset, so
      `initReporting()` no-ops. Needs a native rebuild for `@sentry/react-native`,
      so it is not a same-day fix on release day.
- [ ] **"Recommend" in Settings does nothing** — `settings-screen.tsx:68` has an
      empty `onPress`. Wire it to the share sheet or remove the row.
- [ ] **`pantry_items` still exists in the live DB** despite
      `20260727000007_drop_pantry_items` being recorded as applied, so the type
      generator keeps emitting a table that should be gone. A migration recorded
      as applied that did not apply means the ledger and the database disagree —
      worth understanding rather than papering over.

---

# 7. Food-only scope — open product decisions

The gate itself is done and covered by `DRINKS` / `FOOD_WITH_DRINK` in
`dedup-authenticity.eval.ts`; the rule and its rationale are in CLAUDE.md. What
is left is product, not code:

- [ ] **Give the feed a free-text path, or accept the empty state is defensive.**
      "No drinks, just food" is currently **unreachable on that screen**: the AI
      feed is driven entirely by structured filters, and typing tears it down in
      favour of a catalogue-only `ilike` search
      (`aiEnabled = shouldUseAI && !isSearching`). A drinks-only request cannot be
      expressed there. The path that *can* ask for a mojito is **chat**, which
      drops the dish and explains itself in prose. So the delivered value today is
      the database protection, on every path.
- [ ] **Decide whether drinks ever get a home.** If smoothies and lassi are wanted
      later, the taxonomy needs a `drink` course tag and a `dish_form` value
      before the gate can be narrowed to alcohol — a migration plus a seed change,
      not a prompt edit. Until then "anything drunk" is the honest line, because
      the tag vocabulary cannot represent a beverage.

## App Store rating note

Alcohol does not block release — the rule prohibits *encouraging excessive
consumption*, not recipes containing it — but it moves the age rating, and
**generated content is rated for what it CAN produce, not what it was designed to
produce**. The drinks gate is what makes "this app does not produce cocktail
recipes" a property of the system rather than a hope about the model.

Food recipes still reference alcohol as an ingredient, so the mild tier applies
either way; chasing "no alcohol references" is not worth breaking real dishes for.
**Walk the current App Store Connect questionnaire before declaring a rating** —
the tiers were revised recently and under-declaring is enforced after the fact.

---

# 8. Bedrock inference — BUILT, PARKED, BLOCKED

All 11 text call sites and the vision path go through `@fridgeezy/llm`; no module
in `apps/api` imports a provider SDK. `LLM_PROVIDER` defaults to `openai`, so **no
traffic has ever run on Bedrock** — and none can, because the account's Anthropic
entitlement gate blocks every model.

Hosting is a separate, finished migration: Lambda serves traffic today, and
nothing about the Bedrock decision touches it.

**The open question is "should we switch", not "can we build it".** A cutover buys
IAM instead of an API key, one AWS bill and in-region inference, against a token
bill estimated at ~2x and a full prompt re-validation on prompts tuned to
`gpt-4.1`/`gpt-4o`.

- [ ] ⚠️ **BLOCKED — console action, not possible from the CLI.** Bedrock returns
      *"Model use case details have not been submitted for this account"*. Submit
      the Anthropic use-case form in the Bedrock console, then request access for
      the models in `BLOCKED_ON_MODEL_ACCESS` (`candidates.ts`). **Re-probed
      2026-07-30 and it got worse:** the gate now also catches
      `eu.anthropic.claude-sonnet-4-6`, so *no* Anthropic model runs on this
      account and the eval has no Bedrock candidate at all. Non-Anthropic Bedrock
      is unaffected — `eu.cohere.embed-v4:0` and `eu.amazon.nova-micro-v1:0` both
      invoke fine in eu-central-1 — so this is Anthropic entitlement, not Bedrock
      access.
- [ ] Run `eval-model-migration` on every path once access lands; re-tune prompts
      only where the new model regresses, and record before/after scores.
- [ ] **Gate:** do not cut over until authenticity + structure scores match or
      beat the OpenAI baseline.
- [ ] Cost baseline: real `[LLM]` totals per `label` from CloudWatch, not
      estimates from prompt length. **Half of this is measurable today** — the
      OpenAI side needs no account access.
- [ ] Roll out behind `LLM_PROVIDER`: shadow / percentage cutover, watch eval
      scores and error rates, keep OpenAI as instant rollback.
- [ ] Decommission the OpenAI paths once Bedrock is stable and validated.

## Findings that still bind this work

Kept because the open items above depend on them, and they exist nowhere else.

- **Do not delete `libs/bedrock` while parked.** It has no runtime path and costs
  nothing to carry, and it holds account-specific findings recorded nowhere else.
  It is also the difference between a `gpt-4.1` deprecation being a config change
  and a project.
- **Model IDs must be inference profiles** (`eu.anthropic.*`), not bare
  `anthropic.*` foundation-model IDs, which fail with *"Invocation … with
  on-demand throughput isn't supported"*. Note that `aws bedrock
  list-foundation-models` returns the **wrong form**, and
  `get-foundation-model-availability` reported `AUTHORIZED / AVAILABLE` for models
  that then returned 403 — **neither is a usable access check.**
- **`AnthropicBedrockMantle` is not entitled on this account** — 404/403 across
  eu-central-1, us-east-1 and us-west-2. Use the legacy `AnthropicBedrock`
  (`bedrock-runtime`) client, which works.
- **Do not disable thinking to save tokens on the streaming paths.** On Claude it
  leaks `<thinking>` tags into the *visible* response, corrupting the JSONL line
  it lands on so that line is silently dropped. Prefer adaptive thinking at
  low/medium effort; the harness carries a leak counter for exactly this.
- **Accuracy re-validation is the highest risk in the whole migration.** Every
  prompt is tuned on `gpt-4.1`/`gpt-4o`. Accuracy is the #1 product priority, so
  the eval harness is a prerequisite, not a nicety.
- **Idle-wait billing.** A recipe stream holds ~15–30s mostly waiting on the
  model, and Lambda bills that wall-clock time. Acceptable at low volume; a
  container is cheaper past roughly 25–30k streaming requests/month.
- **Add new streaming endpoints to `eval-model-migration` when they land.**
  Substitutes was built after the original inventory and was therefore neither
  listed nor covered, meaning the gate could have passed without ever exercising
  it. The gate quietly narrows every time this is forgotten.

## Alternative never evaluated

**Claude Platform on AWS** — Anthropic-operated rather than partner-operated,
reached through AWS with SigV4, IAM and Marketplace billing, at same-day feature
parity with the first-party API. Bare model IDs, an `AnthropicAWS` client, a
required `workspace_id`.

Worth probing before committing to Bedrock: it delivers the three things actually
motivating this migration **without** Bedrock's feature subset (which drops
Message Batches, the Files and Models APIs, and every server-side tool).
`libs/bedrock` is one client construction and two response transforms, and
`libs/llm` already resolves providers by name, so evaluating it is roughly a day.
It carries its own entitlement question, which may or may not be easier.

---

# 9. Embeddings migration — RECOMMENDED CUT

> Cutting this means **`OPENAI_API_KEY` stays a hard boot requirement forever**,
> so the "one credential, one bill" benefit motivating the whole Bedrock
> migration is unreachable. Either accept that the migration buys only *text
> inference* on IAM and the AWS bill, or reverse this and do the corpus re-embed.
> **Do not carry both positions at once.**

Embeddings are now the only thing holding the OpenAI key — chat and ingredient
extraction are both ported. Against doing it: embeddings are the one place OpenAI
is meaningfully cheaper, and matching dimensions (Cohere Embed v4 at 1536,
confirmed empirically on this account) avoids the *schema* change but **not the
re-embed**, because the vector spaces differ. The 10 `vector(3072)` columns need
migrating either way.

If it is ever reversed:

- [ ] Migrate the pgvector column dimensions.
- [ ] Re-embed the entire corpus and backfill.
- [ ] Update `use-find-recipes` / FTS+vector search paths to the new column.
- [ ] Validate recommendation quality against the old embeddings before dropping
      the old column.

**Stored vectors must be built by the same code as query vectors** — so
`buildSuggestionSignature` and `embed-suggestions` move together or similarity
silently degrades rather than erroring.

---

# 10. Deferred — universal links for recipe sharing

**Blocked on buying a domain.** Sharing works today: the link opens a browser and
the page offers an "Open in Fridgeezy" button. What is missing is the link itself
opening the app, which needs `associatedDomains` (an entitlement, so a native
rebuild) plus `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` served from that same origin.

**Not the Lambda Function URL** — putting a shared AWS-owned host in the app's
entitlement means claiming a domain we do not control, and the value is baked into
a native build. Point a custom domain at the Function URL instead.

Those two well-known routes need the **`publicRouter` seam** (CLAUDE.md, Routing):
they are fetched by Apple and Google, which hold no Supabase session. Full detail
in the client repo's TODOS.md.

---

# 11. Taste profile — BUILT, DARK, awaiting evidence

**Everything is written and switched off. Recording is deliberately still on.**
Review on **2026-09-13** (four weeks from 2026-08-16), by which point the table
either shows people repeating themselves or it does not.

The app records what a cook asks for more than once — the instruction they type
into `modify`, the direction they push `escalate`, the ingredients they ask
`substitutes` about — and can rewrite a dish to match, as a variant. What is
dark is the *surface*: the "cook it your usual way" offer on a recipe and the
"How You Cook" screen in Settings.

| | |
| --- | --- |
| Server switch | `TASTE_PROFILE_ENABLED=true` (`recipes.routes.ts`) — unset, so `POST /recipes/:recipeId/personalise` is **not registered**: a real 404, absent from the startup banner |
| Client switch | `TASTE_PROFILE_ENABLED` in `src/core/config/flags.ts` — `false` |
| Still running | `profile_taste_signals` keeps filling from `modify` / `escalate` / `substitutes` |

Both switches or neither — the client flag alone gets you a button that 404s.

## The question it is switched off to answer

**Do people repeat themselves often enough for a threshold of two to ever
fire?** The design only acts on a preference asked for twice, because one "make
this vegetarian" is a fact about a dinner party and two is a fact about the
cook. That rule is sound. What is unproven is whether anyone ever reaches it.

Early evidence says **partly, and not where it matters most**. Four real signals
recorded through the running app on 2026-08-15:

```
modification | increase_the_chili_oil_or_add_fresh_chi | 1
modification | increase_the_white_pepper_or_add_chili  | 1
modification | add_chocolate_filling_to_the_croissant  | 1
difficulty   | harder                                  | 1
```

`difficulty` is a closed vocabulary (`easier` / `harder`) and will accumulate.
So will `substitution`, which stores ingredient names. **`modification` almost
certainly will not** — nobody types the same sentence twice, and it was supposed
to be the strongest signal of the three. A feature that fires only on "harder"
is thin.

## What to look at on the review date

```sql
select kind, count(*) filter (where occurrences >= 2) as qualifying,
       count(*) as total, max(occurrences) as best
from profile_taste_signals group by kind;
```

- **Nothing qualifying outside `difficulty`** → take it out. Nothing depends on
  it: drop the two switches, the route, the use case, the client screen and
  offer, and `20260815000007`. The recording call sites are three one-liners.
- **`substitution` and `modification` both qualifying** → turn both switches on
  and fix the defects below.
- **Only `substitution` qualifying** → the honest feature is smaller and is not
  this one: "you never have coriander in" is closer to a soft blacklist than to
  a taste profile, and belongs with `profile_blacklisted_ingredients`.

## Two known defects, deliberately unfixed

Both cost money or effort to fix and neither is worth paying before the data
says the feature lives.

- **Free-text modifications are canonicalised too literally.** "make it spicier"
  and "increase the chili oil" are one preference and two rows. Fixing it means
  mapping free text onto a small vocabulary — a keyword table (cheap, brittle)
  or an LLM classification per modify (accurate, and adds a call to a path that
  currently costs nothing extra). **Do not build the LLM version first.**
- **The stored value is truncated mid-word at 40 characters**, inherited from
  `deriveVariantLabel`, which was written for a *display* label with an ellipsis.
  Harmless as a key — it is deterministic — but the settings screen renders the
  raw value, so it shows "increase the chili oil or add fresh chi". Fix before
  the screen is ever shown to anyone.

## Two decisions already taken, so they are not re-litigated

- **It must never apply at generation time.** `promote` and `generate-recipe`
  persist with `created_by NULL`, into the **shared catalogue** that
  `findByCanonicalName` serves to the next person promoting the same dish — and
  with one slot per `(canonical_id, difficulty)`, whoever promoted first would
  define the dish for everyone. An earlier version did exactly this. It is also
  precisely the drift `verifySuggestionAuthenticity` exists to stop, arriving
  through a door that gate does not watch. Preferences apply as a **variant**,
  the same shape `decideReuse` uses for a blacklist.
- **It is account tier, not premium.** It is `modify` with the instruction read
  off your own history instead of typed, and modify is free — gating it would
  paywall the convenience and nothing else, walkable around by typing "make it
  spicier" yourself. If this is ever to carry a subscription, charge for
  *automatic* application, or use the quota in §2.

## The one thing that is not deferrable

Recording continues while the surface is dark, so the app is accumulating
inferred data about people with **no user-visible way to see or delete it** —
the settings screen that does exactly that is behind the same switch. That is
fine pre-launch and is not fine after. **Before the app ships to real users,
either turn the settings screen back on or gate recording too.** The RLS already
grants the owner `delete` (and deliberately no insert or update), so the
capability exists; what is missing is only the screen.

---

# Out of scope

- Moving images off Gemini.
- Prompt rewrites beyond what evals prove necessary for a model swap.
- Multi-region / HA.
- **Bedrock Guardrails** — evaluated and rejected. Contextual grounding is
  strictly worse than `verifySuggestionAuthenticity` (a generic grounding check
  would never catch a ceviche with no seafood); PII redaction has no subject
  matter here; denied-topics would stop `/rest/chat` being a free general-purpose
  LLM, but auth already closed that and a content filter still bills for every
  filtered request.
- **Bedrock Knowledge Bases, Agents, Model Evaluation** — each has a
  purpose-built in-repo equivalent that fits better: pgvector with custom text
  builders, `usecases/`, and the eval harnesses.

---

# Appendix — RevenueCat go-live, step by step

Everything in item 1, in order. Steps 1–2 are prerequisites that have nothing to
do with this repo and are the slowest; do them first.

## 1. App Store Connect

1. **Paid Applications agreement** must be active, with banking and tax details
   complete. **Nothing else works until this is done** — products stay in
   "Missing Metadata" and RevenueCat returns empty offerings, which looks like a
   code bug and is not one.
2. Create a **subscription group**, then two subscriptions in it — monthly and
   annual. Note each **product ID**.
3. Set the **14-day free trial** as an introductory offer on each, since the
   paywall copy promises one ("First 14 days free").
4. Create a **Sandbox tester** account (Users and Access → Sandbox Testers).

## 2. RevenueCat dashboard

1. Project → add an **iOS app**, bundle id `com.anonymous.fridgeezy`.
2. Paste the **App Store Connect shared secret** (App Store Connect → App
   Information), or RevenueCat cannot validate receipts.
3. **Products** — import or add the two product IDs from step 1.
4. **Entitlement** — create one (e.g. `premium`) and attach both products. The
   identifier is stored as `entitlement_id` but nothing branches on it: the
   client gate and the server check both ask only whether *any* entitlement is
   active.
5. **Offering** — add a monthly and an annual package to it, and make sure it is
   marked **current** in the dashboard. The identifier no longer matters: the
   client reads `offerings.current.availablePackages`, so whichever offering is
   current is the one the paywall sells. It used to read `all.default`, which
   required the identifier to literally be `default` and emptied the paywall
   with no error if it was ever renamed.
6. Confirm the **iOS public SDK key** matches the one hardcoded in
   `src/core/revenuecat/constants/index.ts` (`appl_PypeQOMOR…`).

## 3. Webhook

1. RevenueCat → Integrations → **Webhooks**.
2. URL: `<function-url>/rest/billing/revenuecat`
   (`terraform -chdir=infra output` for the Function URL.)
3. **Authorization header value:** generate a long random string, e.g.
   `openssl rand -base64 32`.

   **The comparison is against the whole header, verbatim.** Whatever you type
   into RevenueCat must equal `REVENUECAT_WEBHOOK_SECRET` exactly — if you type
   `Bearer abc123` there, the env var must be `Bearer abc123` too. RevenueCat
   does not HMAC-sign its webhooks the way Stripe does, so this shared secret is
   the *entire* protection on a route that writes entitlements. Treat it like a
   password.
4. Send the dashboard's **test event**. Expect `200 {"received":true}` and
   `[billing] test event acknowledged` in CloudWatch. A 401 means the two values
   differ.

## 4. This repo

1. Add to `apps/api/.env`:

   ```
   REVENUECAT_WEBHOOK_SECRET=<the same string>
   REQUIRE_ENTITLEMENT=true
   ```

2. Push the secret to SSM — it is already in `put-secrets.sh`:

   ```bash
   ./infra/put-secrets.sh              # dry run, shows what it would write
   APPLY=true ./infra/put-secrets.sh
   ```

3. Flip the gate in `infra/environments/dev.tfvars`:

   ```
   require_entitlement = true
   ```

   The variable and the `lambda.tf` wiring already exist, so this is the only
   edit. It is **not** a secret — it says whether to enforce, not what to enforce
   with — so it lives in the env block rather than SSM.
4. Build and deploy:

   ```bash
   ./infra/build-artifact.sh
   terraform -chdir=infra apply -var-file=environments/dev.tfvars
   ```

5. Confirm the deployed state. **The startup banner does NOT print on Lambda** —
   `startupBanner` is imported only by `main.ts`, the local serve entrypoint, so
   its `billing` line is a check for `npm run api`, never for CloudWatch. On the
   deployed function the two facts are confirmed separately:

   ```bash
   # the flag — from the function's own config, not the banner
   aws lambda get-function-configuration --function-name fridgeezy-dev-api \
     --region eu-central-1 --query 'Environment.Variables.REQUIRE_ENTITLEMENT'

   # the secret — only an actual delivery proves it; nothing reports it at boot
   aws logs tail /aws/lambda/fridgeezy-dev-api --follow --region eu-central-1 \
     | grep --line-buffered "\[billing\]"
   ```

## 5. Device

`react-native-purchases` is native, so **Expo Go cannot test any of this** — you
need a development build.

```bash
npx expo prebuild --clean
npx expo run:ios --device
```

Then, signed into the Sandbox tester account:

1. Sign up as a new user → paywall appears.
2. Buy the monthly package → confirmation screen → tabs open.
3. Check CloudWatch for `[billing] INITIAL_PURCHASE for <uuid> — applied`, and
   `profile_entitlements` for the row.
4. **Kill and relaunch.** The gate must let you in without a second purchase.
5. **Test the lapsed path, not just first-run**: sign in as a user with no
   subscription, confirm the paywall, then **Restore purchases**. This is the
   path where a stale RevenueCat query bounced the user back to the paywall, so
   it is the one worth exercising deliberately.
6. Restore on a second account to see the "Nothing to restore" toast.

## 6. Afterwards

- [ ] Delete the `REQUIRE_ENTITLEMENT` flag and make `requireEntitlement`
      unconditional. It exists only to sequence this rollout.
- [ ] Add the Android SDK key and repeat from step 2 for a Play Store app.
