import type { Router } from "express";

export interface RouteInfo {
    /** Uppercased HTTP methods the path answers, e.g. `["POST"]`. */
    methods: string[];
    /** Full path including the mount prefix, e.g. `/rest/recipes/generate`. */
    path: string;
}

/**
 * Express 5's router internals, narrowed to the two shapes this reads.
 *
 * Deliberately hand-typed: `Router.stack` is not in Express's public types, and
 * the layout changed in v5 (`layer.regexp` gone, `layer.path` `undefined` for
 * mounted routers, matchers now closures over a private regexp). Pinning only
 * what is read keeps the blast radius of a future Express change to this file,
 * and makes it obvious what would need revisiting.
 */
interface RouterLayer {
    name?: string;
    route?: {
        path: string | string[];
        methods?: Record<string, boolean>;
    };
    handle?: { stack?: RouterLayer[] };
}

/**
 * Collect the routes a router registers *directly*, prefixed with `prefix`.
 *
 * Nested routers are not followed: Express 5 no longer exposes their mount path,
 * so descending would produce paths that silently omit a segment — worse than
 * not listing them. The one place this app nests (`createRestRouter`) declares
 * its prefixes as data and calls this per sub-router instead.
 */
/**
 * Join a mount prefix to a route path.
 *
 * A module that registers its own root (`router.post("/")`) would otherwise
 * render as `/rest/chat/` — a path that works but is not the one anybody writes.
 */
function joinPath(prefix: string, path: string): string {
    const joined = `${prefix}${path}`;
    return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

export function collectRoutes(router: Router, prefix = ""): RouteInfo[] {
    const stack = (router as unknown as { stack?: RouterLayer[] }).stack ?? [];
    const routes: RouteInfo[] = [];

    for (const layer of stack) {
        if (!layer.route) continue;

        const methods = Object.entries(layer.route.methods ?? {})
            .filter(([, enabled]) => enabled)
            .map(([method]) => method.toUpperCase())
            // `_all` is Express's internal marker for `router.all()`, not a verb.
            .filter((method) => method !== "_ALL");

        if (methods.length === 0) continue;

        for (const path of [layer.route.path].flat()) {
            routes.push({ methods, path: joinPath(prefix, path) });
        }
    }

    return routes;
}
