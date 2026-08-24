# Error handling, end to end

Written 2026-08-21, the morning the OpenAI credit balance hit zero and nothing
told us. Part 1 (server-side logging) is **implemented**. Parts 2–5 are a
proposal to react to before anything client-side is built.

## The failure this is written against

At 11:28:31 UTC the OpenAI account ran out of credits. Every AI path in the
product stopped working. What each layer did about it:

| Layer | What it did |
| --- | --- |
| OpenAI | `429 insufficient_quota / credit_balance_exhausted` — explicit, unambiguous |
| `libs/llm` | propagated the throw |
| `createStreamHandler` | caught it, wrote `data: {"error":"429 You have no credits remaining."}`, closed the stream **without `[DONE]`** |
| CloudWatch | **nothing** — 0 Lambda `Errors`, 0 `Throttles`, `GET /rest/health` green throughout |
| Alerting | none exists |
| Client | full-screen `crash` state, prominent **Try Again**, which fails identically forever |

Every layer behaved "correctly" and the sum was an outage that was invisible to
us and unintelligible to the user. That is the thing to fix, not the 429.

Three separate defects, and they need separate fixes:

1. **We could not see it.** — fixed, below.
2. **The reason did not survive the trip to the client.** — proposal, §3.
3. **The client has no way to render "temporary, ours, don't retry".** — proposal, §4.

---

## 1. Server-side observability — DONE

### What was wrong

`handleError` sent the error to the *client* and never wrote a line
server-side. The only reason this outage was diagnosable is that
`generateChatStream` carries its own ad-hoc `console.error` — so chat, a
low-traffic feature, was the only endpoint that reported anything. The root
cause on `/rest/suggestions/generate` had to be inferred from the **absence** of
`[LLM]` log lines.

Express's default handler does log throws from the non-streaming controllers
(they `next(err)` and there is no error middleware), so one gap was the
`createStreamHandler` path — 11 modules and most SSE features in the product.

**It was not the only gap, and the second one is worse.** Three SSE endpoints
are hand-rolled Express handlers that never touch the factory, so wiring only
`handleError` left them exactly as silent as before:

| Endpoint | What it logged |
| --- | --- |
| `POST /rest/recipes/:id/chat` | an ad-hoc `console.error` on throw, nothing else |
| `POST /rest/chat` | the same |
| `POST /rest/recipes/:id/compose` | **nothing at all** — both catch arms were empty of logging, on a premium route |

And a throw is not the only way these fail. A recipe-chat turn can end having
emitted neither an answer nor a proposal — an unparseable `DIFFICULTY:` level,
a bare `MODIFY:` with no instruction, a provider that streamed zero tokens.
Every one of those paths returned quietly: the client draws its dead-end-turn
state, the user reports "something went wrong", and the log group holds a clean
200 with nothing in it. That is a second, separate class of invisible failure
and it needed its own reporting, not just error plumbing.

### What changed

**`libs/streaming-server/src/lib/utils/classify-error/`** — new. Maps a thrown
value to three stable facts:

```ts
{ code: string, fault: "client" | "service" | "upstream", retryable: boolean }
```

Verified against the actual error shapes:

| Input | `code` | `fault` | `retryable` |
| --- | --- | --- | --- |
| **the outage** (429 + `credit_balance_exhausted`) | `provider_quota_exhausted` | service | **false** |
| 429 rate limit | `provider_rate_limited` | upstream | true |
| 401 bad key | `provider_auth_failed` | service | false |
| provider 5xx | `provider_unavailable` | upstream | true |
| `ECONNRESET` | `upstream_unreachable` | upstream | true |
| `ZodError` | `bad_request` | client | false |
| anything else | `internal_error` | service | true |

**Splitting the two 429s is the whole point.** A generic rate-limit rule tells
you to back off and retry; no amount of backing off refills a credit balance.
That one distinction is what turns this outage from "mysterious" into a log
line that names the problem.

`fault` and `retryable` are deliberately different axes — an exhausted quota is
`service` **and** not retryable; a rate limit is `upstream` **and** is.

**`libs/streaming-server/src/lib/utils/log-request-error/`** — new, and the
reason it is its own module rather than a private function inside
`error-handler.ts`: the three hand-rolled handlers above have to call it
directly. Two exports.

`logRequestError(error, context)` classifies, writes the line, and hands the
classification back so a caller that also has to pick a status does not
classify twice.

`logRequestAnomaly(reason, context)` is for the second class — a request that
did not throw and did not work either. WARN, because nothing crashed and "the
model said something we could not use" is honestly less severe than a provider
outage; same `[api]` prefix and one-object-per-line shape, so one Logs Insights
query finds both.

`context.route` is required and hand-written (`recipes.chat`,
`suggestions.generate`). It is not derived from `req.url`, because a mounted
Express router only sees its sub-path — `POST /rest/chat` and
`POST /rest/recipes/:id/chat` both arrive looking like `/chat`, and they are
different features with different failure modes. `createStreamHandler` takes an
optional `route` for the same reason and all 11 call sites now set one.

**`libs/streaming-server/src/lib/utils/error-handler/error-handler.ts`** — now
delegates to that, logging one JSON object per failure:

```
[api] request failed {"code":"provider_quota_exhausted","fault":"service",
"retryable":false,"route":"recipes.chat","phase":"provider_event","status":500,
"method":"POST","path":"/1b6bc0c8/chat","streaming":true,
"message":"429 You have no credits remaining.","stack":"...",
"recipeId":"1b6bc0c8-ce45-43ba-93e7-74797d5ea7a6"}

[api] request anomaly {"reason":"empty_turn","route":"recipes.chat",
"phase":"post_stream","method":"POST","path":"/1b6bc0c8/chat",
"streaming":true,"recipeId":"1b6bc0c8","decided":true,"isProposal":true}
```

- **Severity follows `fault`, not status.** `client` → `console.warn`;
  everything else → `console.error`. A malformed body is a normal thing for a
  public API to receive, and paging someone for it trains them to ignore the
  channel.
- **JSON on one line** so Logs Insights can filter on `code` and a metric
  filter can alarm on it. The `[api]` prefix keeps the existing grep-able
  convention.
- **Message and stack only, never the error object.** Provider SDK errors carry
  their full response headers — for OpenAI that includes a `set-cookie` with a
  Cloudflare bot token, which the pre-existing chat `console.error` dumps into
  the log group verbatim. Verified not logged here.
- The query string is stripped from `path` (it can carry a recipe id), by
  the exported `stripQuery` so every call site does it the same way.
- **`phase`** — `pre_stream` | `mid_stream` | `provider_event` | `post_stream`.
  Worth having because the phases differ in what the client can still be told:
  before the stream opens a status code is available, after it opens the only
  channel is a frame.
- **A failure is reported once.** `recipe-chat` tracks whether a specific cause
  has already been named, so a provider error does not also produce an
  `empty_turn` line — otherwise a metric filter counting either would
  double-count one failure.
- `classifyError` matches `ZodError` by `instanceof` **or** by `name`. The name
  arm is not belt-and-braces: it fires when the throw crossed a module boundary
  holding a second copy of zod, where `instanceof` is silently false —
  `compose-recipe.ts` was already written against `error.name === "ZodError"`
  for exactly that reason. Without it a malformed body logs at ERROR as
  `internal_error`, which is the severity meant to page someone.

**The HTTP/SSE response is byte-identical to before.** Reshaping the wire is
§3, and the client has to be taught first.

### Verified

Reproduced the outage with the exact error object from the 11:28:50Z log line
(429, `credit_balance_exhausted`, `insufficient_quota`, and the response
headers carrying the Cloudflare `__cf_bm` bot token): the ERROR line appears
with `provider_quota_exhausted` and the route on it, and the bot token does
not appear anywhere in the output. A `ZodError` reaching it by name alone
classifies `bad_request` and logs at WARN.

`@fridgeezy/streaming-server` builds and lints clean; `@fridgeezy/api` builds,
typechecks and lints clean.

**The dead-end-turn paths are wired but not yet reproduced against a live
provider** — they need a model that actually emits a malformed sentinel, which
is not something to force from here. The next occurrence names itself.

**Not deployed** — say the word.

---

## 2. The taxonomy, and where it lives

The client already has a good taxonomy. The problem is that it has **two of
them and they never meet.**

| | Where | Kinds |
| --- | --- | --- |
| `SSEErrorKind` | `shared/api/streaming/utils/sse-error` | `error`, `payment_required`, `unauthorized`, `unprocessable`, `timeout`, `exception`, `stalled`, `incomplete`, `unparseable`, `reported` |
| `ErrorStateKind` | `shared/ui/components/error-state` | `error`, `crash`, `offline`, `missing`, `notFound` |

`SSEErrorKind` is genuinely well designed — it already separates a paywall from
a fault, and already knows that a 402 must not go to Sentry. **But nothing in
`src/features` maps one to the other.** I grepped: there is not a single
`error.kind` branch that picks an `ErrorStateKind`. So a stream failure either
gets swallowed into a generic state or escapes as a render-time throw into
`createRouteErrorBoundary`, which renders `kind="crash"` — the screen in the
screenshot, with its "Try Again" and its "close Fridgeezy and open it again".

Two consequences:

- **Neither taxonomy can express the quota case.** `ErrorStateKind` has `error`
  (retryable), `crash`, `offline`, `missing`, `notFound`. There is no "ours,
  temporary, nothing for you to do". So the best available match is a lie.
- **`retryable` is nowhere.** Nothing in either enum says whether retrying can
  work, which is why the retry button is unconditional.

**Proposal: three fields cross the wire, and copy is not one of them.**

```
code       stable machine string   provider_quota_exhausted
fault      client | service | upstream
retryable  boolean
retryAfter optional seconds        (rate limits only)
```

The server never sends user-facing prose. It sends facts; the client owns the
words. Two reasons: wording is a product decision that should not need a Lambda
deploy, and localisation lives in the app. This also closes a live leak — today
the raw provider sentence *"You have no credits remaining. Add credits to
continue using the API at platform.openai.com/settings/organization/billing"*
is what `handleError` puts on the wire, and `use-compose-recipe` is already
wired to surface a frame error's message. Our billing problem should never be
rendered to a cook.

---

## 3. The wire contract

### Mid-stream (the outage case)

Today, after headers are sent:

```
data: {"error":"429 You have no credits remaining. Add credits to continue..."}
<connection closes, no [DONE]>
```

Two defects: provider prose leaks, and the missing sentinel makes the client
report `incomplete` — "the server hung up" — rather than the reason it was
handed one line earlier.

Proposed, **backward compatible** (`error` stays a string, siblings are added):

```json
{
  "error": "Recipe ideas are unavailable right now.",
  "code": "provider_quota_exhausted",
  "fault": "service",
  "retryable": false
}
```

followed by `data: [DONE]`, so the stream closes cleanly and the client reports
`reported` (it already has that kind, and it already means exactly this) rather
than `incomplete`.

`error` becomes a safe generic fallback sentence for any client too old to know
`code`. The real copy is chosen client-side.

### Before the stream opens

Same fields in the JSON body, and **the status should stop being a blanket
500**:

| Situation | Today | Proposed |
| --- | --- | --- |
| bad body | 400 | 400 |
| quota / provider down | **500** | **503** + `Retry-After` |
| genuine internal bug | 500 | 500 |

503 is the honest code for "the dependency this needs is not answering", and it
keeps a real bug in our code distinguishable from an unpaid bill in the metrics.

**Decide before I build:** this is a behaviour change on a live endpoint. The
client's `create-sse-client` has explicit branches for 401/402/422 and a
`default` for everything else, so a 503 lands in the default branch and behaves
exactly as the current 500 does — safe to ship server-first. Confirm you want
that ordering.

---

## 4. What the user should see

Add one `ErrorStateKind` and make one existing thing conditional.

**New kind — `serviceDown`:**

```
icon:        cloud-off-outline (neutral tone, not the alert red X)
title:       "This one's on us"
description: "Recipe ideas are temporarily unavailable. We're on it —
              please try again in a few minutes."
actions:     Back to Home only. No retry.
```

Three things it deliberately gets right, against the current screen:

- **It does not blame the user's device.** "close Fridgeezy and open it again"
  is actively misleading during a server-side outage — it sends people to
  reinstall an app that is fine.
- **It says it is temporary and it is ours.** Both are true, both are what a
  person needs to decide whether to wait or give up.
- **There is no button that cannot work.** This is the direct answer to
  "pressing Try Again is kinda pointless".

**The rule that generalises: `retryable` decides whether the retry button
renders.** Not the screen, not the kind — the one field. `ErrorState` already
supports omitting `retry`; today every stream caller passes one unconditionally.

**One mapping function, in the transport layer, so the two taxonomies finally
meet:**

```ts
// shared/api/streaming/utils/sse-error/to-error-state.ts
sseErrorToErrorState(error: unknown): {
  kind: ErrorStateKind;
  retry?: () => void;   // present only when retryable
}
```

| From | To |
| --- | --- |
| `code: provider_quota_exhausted \| provider_auth_failed` | `serviceDown`, no retry |
| `fault: upstream` (rate limit, 5xx, unreachable) | `serviceDown`, **with** retry |
| `timeout`, `stalled`, `exception`, `incomplete` | `error`, with retry |
| `unauthorized` / `payment_required` | unchanged — unlock modal, no error state |
| `unprocessable` | unchanged — caller reads `code` from body |
| network failure | `offline` |

Note `serviceDown` appears twice with different retry affordances. That is the
point: same honest explanation, and the button appears only when pressing it
could work.

**Reporting:** `fault: "service"` should reach Sentry (it is a real defect on
our side). `fault: "upstream"` should be rate-limited or sampled — during a
provider outage every user generates events for one root cause, and the current
`payment_required` reasoning ("a live paywall floods Sentry") applies exactly.

### The catalogue fallback — already built, and narrower than it looked

Decided 2026-08-21: browse surfaces should degrade to the catalogue rather than
show an error. Investigating where to build it found that **the surfaces where
the catalogue is a genuine substitute already do this.** Evidence:

| Surface | Depends on our API? | Behaviour during the outage |
| --- | --- | --- |
| **Home feed** (`HomeFeed`) | **No** | `useFindRecipes` is a Supabase `find_recipes` RPC and `useTagHierarchy` is a Supabase read. Nothing on this screen touches the Lambda. It renders catalogue food throughout an outage. |
| **Search screen** | Partly | Generation runs *only once the catalogue is exhausted* (`shouldUseAI = catalogueAnswered && isSuccess && !hasNextPage`). The failure state is gated on `!hasResults`, so catalogue rows already survive a dead stream. `awaitingFirstBatch` excludes `!current.error`, so a failed stream does not pin the loading interstitial. |
| chat, import, compose, substitutes, modify, escalate, extract-ingredients, recipe generation | Yes | Explicit generation. The catalogue is **not** a substitute — swapping in catalogue dishes would misrepresent what happened. |

So there is no redundant fallback to build, and the line falls exactly where the
architecture already puts it: **generation is a top-up to the catalogue on
browse surfaces, and the sole content everywhere else.** A user who opens the
app during an outage already sees food.

**What is genuinely broken is the one case the catalogue cannot cover**: the
search screen when the filters match nothing in the catalogue *and* generation
fails. It currently renders

> **Search failed** — We couldn't reach the kitchen. Check your connection and
> try again. **[Try Again]**

which during a quota outage blames the user's network for our unpaid bill and
offers a button that cannot work. That is the reported complaint, and fixing it
is a copy change plus gating the button on `retryable` — **blocked on the copy
decision**, not on any missing mechanism.

---

## 5. Alerting — IMPLEMENTED 2026-08-21, `infra/alarms.tf`

`infra/` has no `aws_cloudwatch_metric_alarm` and no `aws_sns_topic`. Zero
alarms. The outage was found because you opened the app.

**`/rest/health` proved nothing.** It answered in 3–5 ms throughout, because it
touches no provider. A liveness check that cannot fail while the product is
100% broken is worse than none — it is a green light over an outage.

Proposed, cheapest first:

1. **Metric filter + alarm on `fault=service`.** Pattern
   `{ $.code = "provider_quota_exhausted" || $.code = "provider_auth_failed" }`,
   threshold ≥ 1 over 1 minute, SNS → email/Slack. These two codes mean *we*
   are broken and will stay broken until a human acts — exactly the definition
   of a page. This alone would have caught today's outage within a minute,
   about 25 minutes before you did.
2. **A second, quieter alarm on `fault=upstream`** at a rate threshold, since
   one transient 503 is noise and fifty is an incident.
3. **Fix the health check** — add a deep mode that makes a 1-token completion.
   It costs a fraction of a cent per probe and is the only check that actually
   exercises the failing path. Keep the shallow one for the load balancer.
   (Caveat worth testing: a `/v1/models` call may still succeed with a zero
   balance, which is why the probe has to spend a token, not just authenticate.)
4. **Prevention, which is the real fix:** OpenAI's own usage-limit emails and
   auto-recharge. No amount of AWS alarming refills the balance; it only
   shortens the outage. This belongs on the OpenAI billing page, not here.

**Not proposed: automatic failover to Bedrock.** `LLM_PROVIDER=bedrock` exists
and every ported call site can reach it, but per `CLAUDE.md` it has never run
end-to-end — Anthropic models are gated on this AWS account. Failing over to an
untested path during an incident is how one outage becomes two. Worth making
real as its own piece of work; not worth wiring to an automatic trigger.

---

## Sequencing

| | Work | State |
| --- | --- | --- |
| ✅ | Server-side logging + classification | **deployed** 2026-08-21 12:02 UTC |
| ✅ | CloudWatch alarms + SNS | **live and verified firing** (§5) |
| ✅ | Catalogue fallback on browse surfaces | **already existed** — see §4 |
| ⏳ | SNS email subscription | one manual command — see `alarms.tf` header |
| 🔒 | Honest error state for explicit-generate paths (§4) | **blocked on copy** |
| 🔒 | Error frame contract, server side (§3) | blocked on the 503-vs-500 call |
| | Health check deep mode (§5.3) | independent, not started |

The two blocked items are the remaining user-visible work, and both wait on a
decision rather than on effort. The frame contract's *additive* half (sending
`code` / `fault` / `retryable` alongside the existing `error` string) needs
neither decision and is the prerequisite for the client branching — worth
splitting out from the status-code question if that one stays open.

## Open questions

1. **503 vs 500** for provider failures — behaviour change on a live endpoint,
   though the client's default branch already handles it identically.
2. **Copy for `serviceDown`.** Mine above is a draft; the voice is yours.
3. **Where should alerts go** — email, Slack, something else?
4. **Is the home-feed catalogue fallback (§4) worth building**, or is an honest
   error screen enough for now?
5. **`fault: upstream` in Sentry** — sample, rate-limit, or drop entirely?
