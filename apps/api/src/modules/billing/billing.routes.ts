import { Router } from "express";

import { BillingController } from "./billing.controller";

const router = Router();

/**
 * "My subscription may have changed — look again."
 *
 * Authenticated and free, on the `account` mount, and it must stay both. The
 * caller is somebody whose device has just been told by RevenueCat that their
 * customer changed, which includes the case where a subscription has just
 * LAPSED — putting that behind `requireEntitlement` would mean the one request
 * that can correct a wrong row is refused precisely when the row is wrong.
 *
 * It is not metered either. A quota is for model spend; this is one HTTP read
 * of RevenueCat, already rate-bounded per user in `reconcileEntitlement`.
 *
 * POST rather than GET because it WRITES `profile_entitlements` — nothing about
 * it is safe to retry from a cache or a link.
 */
router.post("/reconcile", BillingController.reconcile);

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
