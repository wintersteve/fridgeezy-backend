import { Router } from "express";

import { AccountController } from "./account.controller";

const router = Router();

/**
 * Deleting your own account.
 *
 * Account tier, and it has to be: the caller is leaving, and a paywall — or a
 * quota — in front of the exit is the one gate that can never be defensible.
 * The same argument `/prompts` records for a caller deleting what they typed,
 * one step larger.
 *
 * **POST, not DELETE, and that is a client-shaped decision rather than a
 * REST-shaped one.** The app's only helper for talking to this API is
 * `postBackendJson`, which is POST-only and carries the three things a bare
 * `fetch` here would have to grow: the refreshed bearer token, the 401/402 →
 * `FeatureRefusedError` mapping, and the report that feeds the connectivity
 * machine. Widening it to take a method for one caller puts a parameter in
 * front of a dozen call sites that would all pass the same value.
 * `POST /billing/reconcile` is the existing precedent for a state-changing POST
 * with an empty body.
 *
 * `/delete` rather than the bare prefix for the same reason: a bare `POST
 * /account` reads like "create an account", which is the one thing this module
 * must never be mistaken for.
 */
router.post("/delete", AccountController.remove);

export const AccountRoutes = router;
