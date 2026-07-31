import { Router } from "express";

import { ChatRoutes } from "../../../modules/chat";
import { IngredientsRoutes } from "../../../modules/ingredients";
import { RecipesRoutes } from "../../../modules/recipes";
import { SuggestionsRoutes } from "../../../modules/suggestions";
import { collectRoutes, RouteInfo } from "../../../utils/collect-routes";

/**
 * Feature routers and the prefix each is mounted under.
 *
 * Kept as data so the startup banner can be *derived* from the same declaration
 * that does the mounting. Express 5 closes over the compiled matcher for a
 * mounted router and no longer exposes the mount path (`layer.path` is
 * `undefined`, `layer.regexp` is gone), so a prefix cannot be recovered by
 * introspection — it has to be written down exactly once, here.
 */
const MOUNTS: { prefix: string; router: Router }[] = [
    { prefix: "/ingredients", router: IngredientsRoutes },
    { prefix: "/suggestions", router: SuggestionsRoutes },
    { prefix: "/recipes", router: RecipesRoutes },
    { prefix: "/chat", router: ChatRoutes },
];

/** Routes registered directly on the REST router rather than in a feature module. */
function addDirectRoutes(router: Router): void {
    router.get("/health", (_, res) => {
        res.json({ status: "ok" });
    });
}

export function createRestRouter() {
    const router = Router();

    for (const { prefix, router: mounted } of MOUNTS) {
        router.use(prefix, mounted);
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

    return [
        ...collectRoutes(direct, basePath),
        ...MOUNTS.flatMap(({ prefix, router }) =>
            collectRoutes(router, `${basePath}${prefix}`)
        ),
    ].sort((a, b) => a.path.localeCompare(b.path));
}
