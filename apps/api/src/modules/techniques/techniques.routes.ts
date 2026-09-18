import { Router } from "express";

import { TechniquesController } from "./techniques.controller";

const router = Router();

/**
 * The painting for a cooking technique, drawn on the first request for it and
 * read from storage on every one after. **Free to any signed-in account**, and
 * the second route in the app that is.
 *
 * It earns that the same way `/speech/synthesize` does, and then some. Both are
 * content-addressed, so the first caller pays and everyone afterwards gets a
 * storage read — but speech is keyed on arbitrary TEXT, which is unbounded in
 * principle, while this is keyed on a row in `cooking_actions`. That table is a
 * curated ~148 rows and the service refuses anything not in it, so the total
 * this route can cost across every user for all time is those 148 images once,
 * about ten dollars. A 149th distinct request cannot exist.
 *
 * Metering it would therefore be charging for something that has no marginal
 * cost, which is exactly the line `FEATURE_TIER` draws — and it would put a
 * paywall in front of the reader who is by definition the least expert one
 * here, since the question being answered is "what does this word mean".
 */
router.post("/illustrate", TechniquesController.illustrate);

export const TechniquesRoutes = router;
