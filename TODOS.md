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
- [ ] **Decide what a 402 should *do* in the client.** Today it shows copy.
      Auto-redirecting to the paywall was deliberately not built: right after a
      real purchase the device says subscribed while the server has not yet seen
      the webhook, so a redirect sends a paying user to a paywall they cannot
      satisfy. Fix the window above first.

---

# 2. No per-user rate limiting

Authentication bounds *who* can spend, not *how much*. Once item 1 is live,
entitlement becomes the ceiling and this drops in priority — until then anyone
who can sign up can loop the feed, and `reserved_concurrent_executions`
(dev 5 / prod 50) caps concurrency rather than volume.

The Function URL is `AuthType: NONE` by design and cannot change (see CLAUDE.md),
so any limit has to live in the app, alongside `requireSupabaseUser` and
`requireEntitlement` in the `MOUNTS` loop.

---

# 3. Auth — email confirmation and social sign-in

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

# 4. Smaller, but each one is user-visible

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

# 5. Food-only scope — open product decisions

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

# 6. Bedrock inference — BUILT, PARKED, BLOCKED

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

# 7. Embeddings migration — RECOMMENDED CUT

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

# 8. Deferred — universal links for recipe sharing

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
5. **Offering** — this one is exact. The client reads
   `offerings.all.default.availablePackages`, so the offering's identifier must
   literally be **`default`**. Add a monthly and an annual package to it.
   An offering named anything else yields an empty paywall with no error.
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

5. Confirm on the deployed function: the startup banner's `billing` line should
   read `active subscription required`. While anything is missing it says so —
   `⚠ NOT ENFORCED` if the flag is unset, or `⚠ enforced, but
   REVENUECAT_WEBHOOK_SECRET is unset` if the secret did not arrive.

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
