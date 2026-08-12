import { Router } from "express";

import { requireEntitlement } from "../../middleware/require-entitlement";

import { RecipesController } from "./recipes.controller";

const router = Router();

router.post("/generate", RecipesController.generate);
router.post("/difficulty/escalate", RecipesController.escalate);
router.post("/modify", RecipesController.modify);

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
