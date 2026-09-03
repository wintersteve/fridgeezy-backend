import { Router } from "express";

import { requireEntitlement } from "../../middleware/require-entitlement";
import { requireQuota } from "../../middleware/require-quota";

import { SuggestionsController } from "./suggestions.controller";

const router = Router();

/**
 * **Not metered, and paid in full.** The feed generates dish ideas ambiently as
 * the reader scrolls, so nobody experiences this as an action they took — "you
 * are out of ideas" would point at nothing on screen. The catalogue already
 * holds hundreds of stored suggestions that are free to read, which is what
 * makes the split work: the IDEAS are free, and what costs money is turning one
 * into a recipe.
 */
router.post("/generate", requireEntitlement, SuggestionsController.generate);

/**
 * A dish BY NAME -> the id that opens it.
 *
 * One static segment, so it never competes with `/:id/promote` below however
 * the two are ordered — that one is two segments and this is one, and Express
 * never has to choose.
 */
router.post("/resolve", requireQuota("recipes"), SuggestionsController.resolve);
// The teaser boundary, and the most persuasive gate in the app: somebody is
// holding a dish they have already decided they want. `promote` returns the
// finished row for an already-promoted suggestion without running a model, and
// that path waives the charge — see `QuotaHandle.waive`.
router.post("/:id/promote", requireQuota("recipes"), SuggestionsController.promote);

export const SuggestionsRoutes = router;
