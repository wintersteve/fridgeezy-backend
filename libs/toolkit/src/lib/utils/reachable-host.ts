/**
 * Is this host only reachable from the writer's own network?
 *
 * Loopback plus the three RFC 1918 private ranges. Written once and shared
 * because two callers decide the SAME question and must not disagree about it:
 * `repair-recipe-image-urls.ts`, which rewrites `recipes.image` rows, and the
 * admin console's overview, which counts how many need rewriting. A private
 * copy in either would be a count that disagrees with the repair — the console
 * reporting nothing to fix while rows stay broken, or the reverse.
 *
 * ## What it is for
 *
 * Found in production on 2026-09-23: 49 of 54 recipes carried
 * `http://192.168.1.6:54321/...` — a developer's LAN address — as their image.
 * Every share link served it as `og:image`, and every reader of the catalogue
 * got no picture. The bytes were in the right bucket the whole time; only the
 * stored host was wrong.
 *
 * `toDeviceReachable` is a no-op in every deployed configuration by
 * construction, so the API cannot write one of these. They can only be COPIED
 * in — a dump and restore, or a seed built from a local stack — which is a
 * failure nothing in the code path can prevent and everything downstream should
 * be able to SEE.
 *
 * ## It answers about the host, never about a pair of them
 *
 * The tempting test is "does this differ from the origin we expect", and it is
 * wrong in the case that matters: on a local stack `SUPABASE_URL` is loopback
 * while the stored URL deliberately carries the LAN address, so an origin
 * comparison flags every correct row. Both halves of a private-to-private
 * mismatch are fine; what is never fine is a private host in a database the
 * public is served from. So callers ask this about the stored host, and
 * separately about their own, rather than comparing the two.
 */
export const isPrivateHost = (hostname: string): boolean =>
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname);

/**
 * True when `url` is a stack the public can reach, i.e. worth auditing stored
 * URLs against. False for a local stack, where a private storage host is the
 * intended value and there is nothing to repair.
 *
 * Returns false for an unparseable URL: a caller that cannot tell where it is
 * pointing should do nothing rather than assume it is production.
 */
export const isPubliclyServed = (url: string): boolean => {
    try {
        return !isPrivateHost(new URL(url).hostname);
    } catch {
        return false;
    }
};
