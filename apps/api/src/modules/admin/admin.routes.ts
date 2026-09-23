import express, { Router } from "express";

import { allowFree } from "../../middleware/allow-free";

import { AdminController } from "./admin.controller";
import { requireAdmin } from "./services";

const router = Router();

/**
 * The admin console's API.
 *
 * ## Two gates, and the mount only supplies one of them
 *
 * `requireSupabaseUser` comes from the `account` mount in `rest/index.ts`;
 * `requireAdmin` is applied here, to the whole router, before any route. It is
 * `router.use` rather than a per-route middleware for the same reason the mount
 * loop is the only way a feature router gets mounted: a route added to this
 * file cannot be ungated by forgetting something.
 *
 * ## Why this parses JSON when nothing else in the app does
 *
 * `express-app.ts` omits `express.json()` on purpose — the AI handlers read the
 * raw request stream themselves, and a body parser upstream consumes it and
 * hangs them. That reasoning is about THOSE handlers, so the parser is applied
 * here, to this router only, where every body is a small JSON object and
 * nothing streams. The limit is deliberate: the largest thing sent here is a
 * recipe's method.
 *
 * ## `allowFree` on every route, and they are genuinely free
 *
 * This mount is `account` tier, so `assertMeteredMountsAreGated` does not
 * apply — the claim is attached anyway, because `POST /recipes/:id/image` DOES
 * spend (two image generations a press) and the absence of a quota there is a
 * decision rather than an omission. An admin is the person who owns the bill,
 * metering them would only get in the way of the job, and the gate that
 * matters is `requireAdmin`.
 */
router.use(requireAdmin);
router.use(express.json({ limit: "1mb" }));

const free = allowFree("Admin console. Gated by requireAdmin, not by tier.");

router.get("/overview", free, AdminController.overview);

// Recipes. `/hidden`, `/image` and `/steps` are sub-paths rather than fields on
// the PATCH because each does something a field cannot: one writes three
// columns and an actor, one spends money and takes seconds, one replaces a
// whole child table.
router.get("/recipes", free, AdminController.listRecipes);
router.get("/recipes/:id", free, AdminController.getRecipe);
router.patch("/recipes/:id", free, AdminController.updateRecipe);
router.put("/recipes/:id/steps", free, AdminController.replaceRecipeSteps);
router.post("/recipes/:id/hidden", free, AdminController.setRecipeHidden);
router.post("/recipes/:id/image", free, AdminController.regenerateImage);
// Per-step cook-mode art. The one pair of routes here that spends money by the
// DOZEN — see `step-art.ts` for the arithmetic and for why the deployment flag
// deliberately does not apply to them.
//
// The browser sits under its own prefix rather than on `/recipes`, because it
// answers a question about STEP ART that happens to be shaped like a recipe
// list — "which dishes have none" — and hanging it off the catalogue's own
// route would put a storage listing in front of a plain read.
router.get("/step-art/recipes", free, AdminController.listStepArtRecipes);
router.get("/recipes/:id/step-art", free, AdminController.getStepArt);
router.post("/recipes/:id/step-art", free, AdminController.drawStepArt);

// Technique paintings. Bounded in a way step art is not: the vocabulary is a
// curated ~148 rows and the generator refuses anything outside it, so the whole
// feature converges on about ten dollars and then stops costing anything.
router.get("/techniques", free, AdminController.listTechniques);
router.post("/techniques/art", free, AdminController.drawTechniqueArt);
router.delete("/recipes/:id", free, AdminController.deleteRecipe);

router.get("/suggestions", free, AdminController.listSuggestions);
router.post("/suggestions/:id/hidden", free, AdminController.setSuggestionHidden);
router.delete("/suggestions/:id", free, AdminController.deleteSuggestion);

// `/categories` before `/ingredients/:id` would be a collision if it lived
// under that prefix; it does not, and is kept a sibling for that reason.
router.get("/ingredients", free, AdminController.listIngredients);
router.patch("/ingredients/:id", free, AdminController.updateIngredient);
router.get("/categories", free, AdminController.listCategories);

router.get("/tags", free, AdminController.listTags);
router.patch("/tags/:id", free, AdminController.updateTag);

router.get("/users", free, AdminController.listUsers);
router.patch("/users/:profileId", free, AdminController.updateUser);

export const AdminRoutes = router;
