import { Router } from "express";

import { RecipesController } from "./recipes.controller";

/**
 * The taste-profile surface — `POST /:recipeId/personalise` and everything the
 * client hangs off it — is **off unless this is set**, and it is set nowhere.
 *
 * CLAUDE.md's rule is "build a flag scoped to a risky change, not as a standing
 * fixture", and this is the first half of that: a scoped switch with a decision
 * date, recorded in TODOS.md §11. It is not a permanent configuration knob.
 * When the evaluation lands, this and the route below either become
 * unconditional or leave together — do not let it settle in as furniture.
 *
 * **Recording is deliberately NOT behind this.** `profile_taste_signals` keeps
 * filling from `modify`, `escalate` and `substitutes` while the surface is
 * dark, because the whole question the evaluation has to answer — do people
 * repeat themselves often enough for a threshold of two to ever fire — can only
 * be answered by data that accumulates in the meantime. Turning the switch on
 * later with an empty table would just restart the wait.
 */
const TASTE_PROFILE_ENABLED = process.env.TASTE_PROFILE_ENABLED === "true";

const router = Router();

router.post("/generate", RecipesController.generate);
router.post("/difficulty/escalate", RecipesController.escalate);
router.post("/modify", RecipesController.modify);

/**
 * Read a recipe off a photograph and save it as the caller's own.
 *
 * A static segment, so it is unambiguous against the `/:recipeId/...` routes
 * below whatever order they are registered in — those are two segments and this
 * is one, and Express never has to choose.
 *
 * **Premium, with the rest of this mount.** It was account tier until
 * 2026-08-26 on the argument that it produces content the user brought in
 * rather than content this app wrote for them — true, and no longer the test.
 * The line is now simply whether a model runs, and reading a page is a vision
 * call. See the use case for why the route is SSE despite the read itself being
 * a single blocking call.
 */
router.post("/import", RecipesController.import);

/**
 * Compose a menu around this dish.
 *
 * It carried the app's only `requireEntitlement` until 2026-08-26, back when the
 * free/paid line ran *through* this module. It no longer does — every route here
 * is paid — so the gate moved to the mount (`MOUNTS` in `rest/index.ts`) and
 * this is an ordinary line again. **Do not re-add it here**: the middleware is
 * not idempotent in any useful way, it would cost a second entitlement lookup
 * per request, and a second place to declare the tier is a second place for it
 * to disagree with the banner.
 */
router.post("/:recipeId/compose", RecipesController.compose);

router.post("/:recipeId/chat", RecipesController.chat);

/**
 * Adapt this dish to the caller's diet by swapping the one ingredient in the
 * way — the tap behind a near-miss card.
 *
 * Two segments, so it never competes with the static `/import` and `/modify`
 * above whatever order Express registers them in.
 *
 * The recipe id travels in the BODY as well as the path, and that is not
 * redundancy to tidy away: `createStreamHandler` validates the body against
 * `AdaptRecipeRequestSchema` and the handler reads `body.id`, exactly as
 * `modify` does. The path segment is what makes the route read like its
 * siblings; a request whose two disagree is refused by the id the schema
 * validated, which is the one the handler acts on.
 */
router.post("/:recipeId/adapt", RecipesController.adapt);

/**
 * Rewrite this dish the way the caller keeps asking for it, as a variant.
 *
 * **Registered only when `TASTE_PROFILE_ENABLED` is set**, which it is not — so
 * this is a 404 today and does not appear in the startup banner at all. That is
 * deliberate over returning 403 from a mounted route: an unmounted path leaks
 * nothing about a feature that has not been decided on, and the banner stays an
 * honest inventory of what the server actually serves.
 *
 * **Premium when it does come back**, and the argument that used to say
 * otherwise has dissolved rather than been overruled. It ran: this is
 * `POST /recipes/modify` with the instruction read off the caller's own history
 * instead of typed, modify is free, so gating this paywalls the convenience and
 * nothing else — walkable around by typing "make it spicier" yourself.
 *
 * Modify is not free any more. The walk-around it pointed at is now behind the
 * same gate, so the objection has no free equivalent left to compare against and
 * this simply inherits the mount's tier like everything else here. Automatic
 * application — the thing TODOS said to charge for if anything — is what this
 * route is.
 */
if (TASTE_PROFILE_ENABLED) {
    router.post("/:recipeId/personalise", RecipesController.personalise);
}

export const RecipesRoutes = router;

const publicRouter = Router();

/**
 * The share page, deliberately outside the auth gate.
 *
 * It is the one route here whose caller is not the app: a link preview is built
 * by the *receiving* application — iMessage, WhatsApp, Slack — which fetches the
 * URL with no notion of a Supabase session, as does the browser of whoever taps
 * the link. Gating it returns 401 to every one of them, so the preview card and
 * the page both disappear. That is exactly what happened between 2026-08-04 and
 * 2026-08-06, when the route was added before the gate and swept up by it.
 *
 * Safe to open because it serves nothing an authenticated call would not: a
 * recipe's name, gloss and image, keyed by an id the sharer chose to hand out,
 * with no LLM call and so no spend behind it. Keep it that way — a route on this
 * router is world-readable, which is why it is a separate export rather than a
 * flag on a route in the list above.
 */
publicRouter.get("/:recipeId/share", RecipesController.share);

export const RecipesPublicRoutes = publicRouter;
