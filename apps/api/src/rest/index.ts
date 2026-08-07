import { Router } from "express";

import { requireSupabaseUser } from "../middleware/require-auth";
import { requireEntitlement } from "../middleware/require-entitlement";
import { BillingPublicRoutes, BillingRoutes } from "../modules/billing";
import { ChatRoutes } from "../modules/chat";
import { IngredientsRoutes } from "../modules/ingredients";
import { RecipesPublicRoutes, RecipesRoutes } from "../modules/recipes";
import { SubstitutesRoutes } from "../modules/substitutes";
import { SuggestionsRoutes } from "../modules/suggestions";
import { collectRoutes, RouteInfo } from "../utils/collect-routes";

interface Mount {
    prefix: string;
    /** Mounted behind {@link requireSupabaseUser}. This is the default. */
    router: Router;
    /**
     * Mounted at the same prefix with **no** authentication, ahead of `router`.
     *
     * Optional and named positively so that open routes are declared rather than
     * defaulted into: a module that omits this is gated in full, and opening a
     * route means writing it down here where it is visible in a diff and in the
     * startup banner. Only for routes whose caller cannot hold a session; see
     * `RecipesPublicRoutes` (read-only) and `BillingPublicRoutes` (writes, and
     * therefore carries its own shared-secret check).
     */
    publicRouter?: Router;
    /**
     * Set to skip {@link requireEntitlement} on this module's gated routes.
     *
     * Defaults to enforcing, so a new feature module costs LLM spend only for
     * subscribers unless someone deliberately says otherwise. `billing` is the
     * only exemption and has to be: it is how a user obtains an entitlement, so
     * requiring one to reach it is a loop with no entry.
     */
    entitlementExempt?: boolean;
}

/**
 * Feature routers and the prefix each is mounted under.
 *
 * Kept as data so the startup banner can be *derived* from the same declaration
 * that does the mounting. Express 5 closes over the compiled matcher for a
 * mounted router and no longer exposes the mount path (`layer.path` is
 * `undefined`, `layer.regexp` is gone), so a prefix cannot be recovered by
 * introspection — it has to be written down exactly once, here.
 */
const MOUNTS: Mount[] = [
    { prefix: "/ingredients", router: IngredientsRoutes },
    { prefix: "/suggestions", router: SuggestionsRoutes },
    { prefix: "/recipes", router: RecipesRoutes, publicRouter: RecipesPublicRoutes },
    { prefix: "/substitutes", router: SubstitutesRoutes },
    { prefix: "/chat", router: ChatRoutes },
    {
        prefix: "/billing",
        router: BillingRoutes,
        publicRouter: BillingPublicRoutes,
        entitlementExempt: true,
    },
];

/** Routes registered directly on the REST router rather than in a feature module. */
function addDirectRoutes(router: Router): void {
    router.get("/health", (_, res) => {
        res.json({ status: "ok" });
    });
}

export function createRestRouter() {
    const router = Router();

    // Authentication is applied per-mount rather than to the whole router, so
    // that /health stays reachable without a token — a health check that needs
    // credentials cannot answer the question it exists to answer. Every mount is
    // covered because the loop is the only way a feature router gets mounted;
    // adding one to MOUNTS cannot accidentally leave it open.
    for (const {
        prefix,
        router: mounted,
        publicRouter,
        entitlementExempt,
    } of MOUNTS) {
        // The open routes go first, because order is what decides this: Express
        // walks layers in registration order, so a request matching a route on
        // `publicRouter` is answered before the gated mount is ever reached.
        // Anything it does not match falls through to the gate below, which is
        // why mounting a near-empty router at a shared prefix is safe.
        if (publicRouter) {
            router.use(prefix, publicRouter);
        }

        // Entitlement runs after authentication and never instead of it: it
        // reads the user id that `requireSupabaseUser` resolved, so the order is
        // a data dependency rather than a preference.
        const gate = entitlementExempt
            ? [requireSupabaseUser]
            : [requireSupabaseUser, requireEntitlement];

        router.use(prefix, ...gate, mounted);
    }

    addDirectRoutes(router);

    return router;
}

/**
 * Every endpoint the REST router serves, as full paths under `basePath`.
 *
 * Derived from {@link MOUNTS} and the routers themselves, so adding a route to
 * any feature module shows up here with no second place to update — which is the
 * point, since the previous hand-written startup list had drifted to four of the
 * ten real endpoints.
 */
export function describeRestEndpoints(basePath = ""): RouteInfo[] {
    const direct = Router();
    addDirectRoutes(direct);

    const open = (routes: RouteInfo[]): RouteInfo[] =>
        routes.map((route) => ({ ...route, isPublic: true }));

    return [
        // `/health` is ungated too, and saying so here means the banner's list of
        // open routes is the whole list rather than the part that came from a
        // feature module.
        ...open(collectRoutes(direct, basePath)),
        ...MOUNTS.flatMap(({ prefix, router, publicRouter }) => [
            ...collectRoutes(router, `${basePath}${prefix}`),
            ...open(
                publicRouter ? collectRoutes(publicRouter, `${basePath}${prefix}`) : []
            ),
        ]),
    ].sort((a, b) => a.path.localeCompare(b.path));
}
