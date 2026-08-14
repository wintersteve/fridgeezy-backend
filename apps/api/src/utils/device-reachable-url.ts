import { execFileSync } from "node:child_process";

/**
 * This Mac's LAN address, or null when there isn't one (offline, or not macOS).
 *
 * Memoized because it shells out and this is called once per generated asset
 * URL. A process that outlives a DHCP change is a restart away from being
 * right, which is the same deal `nx serve` already offers for every other
 * `.env` value.
 */
let lanAddress: string | null | undefined;

const hostAddress = (): string | null => {
    if (lanAddress !== undefined) return lanAddress;

    try {
        lanAddress =
            execFileSync("ipconfig", ["getifaddr", "en0"], {
                stdio: ["ignore", "pipe", "ignore"],
            })
                .toString()
                .trim() || null;
    } catch {
        lanAddress = null;
    }

    return lanAddress;
};

/**
 * Swaps loopback for the LAN address on a URL that is about to be handed to
 * the phone. Shared by every service that persists or returns a Supabase
 * Storage URL — first written for recipe images, and speech clips hit the
 * exact same trap: silent, unreported failure, since the client's audio/image
 * loader just never resolves rather than throwing.
 *
 * `SUPABASE_URL` is deliberately loopback in local development: the API and
 * the Docker stack share a machine, so pinning it to a LAN IP only bought a
 * value that goes stale every time the router — or a different network —
 * hands out a new lease. Public storage URLs are the exception, because they
 * do not stay on this machine: they are persisted and/or streamed straight to
 * a client, and on a physical device `127.0.0.1` means THAT DEVICE and
 * reaches nothing. The iOS Simulator shares the Mac's network namespace and
 * would work either way, which is why this can go unnoticed on a simulator
 * and only bite on a real phone.
 *
 * A no-op in every deployed configuration, by construction rather than by a
 * flag — Lambda's `SUPABASE_URL` is the project's https origin, which has no
 * loopback host to match.
 */
export const toDeviceReachable = (url: string): string => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(url)) return url;

    const host = hostAddress();
    return host ? url.replace(/127\.0\.0\.1|localhost/, host) : url;
};
