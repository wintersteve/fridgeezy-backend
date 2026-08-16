import { Router } from "express";

import { requireEntitlement } from "../../middleware/require-entitlement";

import { RecipesController } from "./recipes.controller";

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
 * Account tier, not premium: it is one vision call, and what it produces is
 * content the user brought in rather than content this app wrote for them. See
 * the use case for that decision and for why the route is SSE despite the read
 * itself being a single blocking call.
 */
router.post("/import", RecipesController.import);

/**
 * The one premium route, and the reason `requireEntitlement` is attached per
 * route rather than per mount: the free/paid line runs through this module, not
 * between modules. Generating, modifying and escalating a recipe are what a
 * signed-in account gets; composing a whole menu around one is what a
 * subscription gets.
 *
 * `requireSupabaseUser` still runs first — it is applied to the whole mount by
 * `createRestRouter`, and this gate reads the user id it resolves. Adding a
 * premium route means adding this middleware *and* checking it shows up as
 * `← premium` in the startup banner.
 */
router.post("/:recipeId/compose", requireEntitlement, RecipesController.compose);

router.post("/:recipeId/chat", RecipesController.chat);

/**
 * Rewrite this dish the way the caller keeps asking for it, as a variant.
 *
 * **Account tier, not premium, and that is on purpose rather than an
 * oversight.** It is `POST /recipes/modify` with the instruction read off the
 * caller's own history instead of typed — and modify is free. Gating this while
 * the manual equivalent sits next door unmetered would paywall the convenience
 * and nothing else, which anyone can walk around by typing "make it spicier"
 * themselves. If standing preferences are to carry a subscription, the thing to
 * charge for is having them applied *automatically* rather than on request, or
 * the per-user quota sketched in TODOS — not this route.
 */
router.post("/:recipeId/personalise", RecipesController.personalise);

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
