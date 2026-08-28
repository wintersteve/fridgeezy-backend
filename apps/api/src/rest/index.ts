import { Router } from "express";

import { requireSupabaseUser } from "../middleware/require-auth";
import { requireEntitlement } from "../middleware/require-entitlement";
import { BillingPublicRoutes, BillingRoutes } from "../modules/billing";
import { ChatRoutes } from "../modules/chat";
import { IngredientsRoutes } from "../modules/ingredients";
import { PromptsRoutes } from "../modules/prompts";
import { RecipesPublicRoutes, RecipesRoutes } from "../modules/recipes";
import { SpeechRoutes } from "../modules/speech";
import { SubstitutesRoutes } from "../modules/substitutes";
import { SuggestionsRoutes } from "../modules/suggestions";
import { collectRoutes, RouteInfo } from "../utils/collect-routes";

/**
 * What a caller must hold to reach a mount.
 *
 * `subscriber` is the DEFAULT and `account` is the exception, which inverts what
 * this file did before 2026-08-26. See {@link MOUNTS}.
 */
type MountTier = "account" | "subscriber";

interface Mount {
    prefix: string;
    /** Mounted behind {@link requireSupabaseUser}. This is the default. */
    router: Router;
    /**
     * What the mount costs. Omitted means `subscriber`, so a new feature module
     * is paid unless it says otherwise — see {@link MOUNTS}.
     */
    tier?: MountTier;
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
}

/**
 * Feature routers, the prefix each is mounted under, and what each costs.
 *
 * Kept as data so the startup banner can be *derived* from the same declaration
 * that does the mounting. Express 5 closes over the compiled matcher for a
 * mounted router and no longer exposes the mount path (`layer.path` is
 * `undefined`, `layer.regexp` is gone), so a prefix cannot be recovered by
 * introspection — it has to be written down exactly once, here.
 *
 * ## Why `tier` lives here and defaults to `subscriber`
 *
 * The product's rule is now one sentence: **every AI feature is paid, everything
 * else is free.** Reads (the catalogue), writes the user owns (saves,
 * collections, shopping lists, menus, dietary filters) never reach this API at
 * all — the client holds them in Supabase directly. So what is left under
 * `/rest` is almost entirely LLM spend, and five of these eight mounts are paid
 * in full.
 *
 * That collapses the reason the gate was ever attached per route. It moved there
 * on 2026-08-12 because the split ran *through* the recipes module — `generate`
 * free, `compose` paid — which a mount cannot express. It can express this one,
 * and moving it back buys the property `require-entitlement.ts` used to warn was
 * missing: **forgetting to declare a tier now fails CLOSED.** A new feature
 * module is paid until someone writes `tier: "account"` next to it, rather than
 * being given away by an omission nobody sees.
 *
 * Two mounts are `account`, and both are exceptions worth stating:
 *
 * - **`/speech`** — the one mount whose boundary still runs through it, so it
 *   keeps a per-route `requireEntitlement` on `/command`. Synthesis is free
 *   because it is content-addressed: the same text hashes to the same object, so
 *   a step spoken once is a storage read for every listener afterwards, forever.
 *   Understanding a spoken command is an ordinary model call with no such cache.
 * - **`/prompts`** — a caller reading or deleting the record of what they
 *   themselves typed. No spend, and gating it would put a paywall in front of
 *   somebody trying to delete their own data.
 */
const MOUNTS: Mount[] = [
    { prefix: "/ingredients", router: IngredientsRoutes },
    { prefix: "/suggestions", router: SuggestionsRoutes },
    { prefix: "/recipes", router: RecipesRoutes, publicRouter: RecipesPublicRoutes },
    { prefix: "/substitutes", router: SubstitutesRoutes },
    { prefix: "/chat", router: ChatRoutes },
    // Splits internally: /synthesize is free, /command carries its own gate.
    { prefix: "/speech", router: SpeechRoutes, tier: "account" },
    { prefix: "/prompts", router: PromptsRoutes, tier: "account" },
    { prefix: "/billing", router: BillingRoutes, publicRouter: BillingPublicRoutes, tier: "account" },
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
    for (const { prefix, router: mounted, publicRouter, tier } of MOUNTS) {
        // The open routes go first, because order is what decides this: Express
        // walks layers in registration order, so a request matching a route on
        // `publicRouter` is answered before the gated mount is ever reached.
        // Anything it does not match falls through to the gate below, which is
        // why mounting a near-empty router at a shared prefix is safe.
        if (publicRouter) {
            router.use(prefix, publicRouter);
        }

        // Both gates, in this order: `requireEntitlement` reads the user id
        // `requireSupabaseUser` resolved, so it cannot run first. An `account`
        // mount takes authentication only and may still carry the paid gate on
        // an individual route — that is what `/speech/command` does.
        const gates =
            (tier ?? "subscriber") === "subscriber"
                ? [requireSupabaseUser, requireEntitlement]
                : [requireSupabaseUser];

        router.use(prefix, ...gates, mounted);
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

    // A subscriber-tier mount makes every route under it premium. `collectRoutes`
    // cannot see this — it reads a route's OWN handler stack, and a mount-level
    // middleware is not in it — so the tier is OR'd in here, the same way
    // `isPublic` already is. The per-route derivation is still what catches a
    // gate inside an `account` mount, which is the only reason it stays.
    const paid = (routes: RouteInfo[]): RouteInfo[] =>
        routes.map((route) => ({ ...route, requiresEntitlement: true }));

    return [
        // `/health` is ungated too, and saying so here means the banner's list of
        // open routes is the whole list rather than the part that came from a
        // feature module.
        ...open(collectRoutes(direct, basePath)),
        ...MOUNTS.flatMap(({ prefix, router, publicRouter, tier }) => {
            const mounted = collectRoutes(router, `${basePath}${prefix}`);

            return [
                ...((tier ?? "subscriber") === "subscriber" ? paid(mounted) : mounted),
                ...open(
                    publicRouter ? collectRoutes(publicRouter, `${basePath}${prefix}`) : []
                ),
            ];
        }),
    ].sort((a, b) => a.path.localeCompare(b.path));
}
