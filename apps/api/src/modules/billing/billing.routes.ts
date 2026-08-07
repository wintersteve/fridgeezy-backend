import { Router } from "express";

import { BillingController } from "./billing.controller";

/**
 * No gated routes yet.
 *
 * Exported anyway, and mounted, so that billing follows the same shape as every
 * other module: a module whose only router is the public one would have to be
 * mounted a different way, and a special case is how a route ends up outside the
 * loop that applies authentication.
 */
const router = Router();

export const BillingRoutes = router;

const publicRouter = Router();

/**
 * The RevenueCat webhook, outside the auth gate because RevenueCat is a
 * server-to-server caller with no Supabase session — the same reason the share
 * page is open.
 *
 * **The resemblance stops there, and the difference is the important part: this
 * route WRITES.** `/share` is safe to expose because the worst an anonymous
 * caller gets is a recipe's name and picture. An unprotected entitlement
 * webhook would let anyone grant themselves a subscription. The shared secret
 * checked in `revenuecatWebhook` is what replaces the auth gate here, and it is
 * verified before the body is read.
 *
 * The seam makes a route reachable. It does not make it safe — that is the
 * handler's job, and any future entry here has to earn it the same way.
 */
publicRouter.post("/revenuecat", BillingController.revenuecat);

export const BillingPublicRoutes = publicRouter;
