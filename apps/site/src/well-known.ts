/**
 * The two files that make a link open the app instead of a browser tab.
 *
 * Both are fetched by Apple and Google — never by a person — from the apex of
 * the claimed domain, and both have to be served from the same origin as the
 * links they authorise. That is why they are objects in this static site rather
 * than routes on the API: with the site at the apex, S3 *is* that origin, so no
 * Lambda, no `publicRouter` entry and no cold start sits in front of a file
 * Apple may re-fetch at any time. (The backend's TODOS planned them as Express
 * routes, which was the right answer while the domain was going to point at the
 * Function URL.)
 *
 * Three rules hold them up, and every one of them fails silently:
 *
 *  - **No redirect may stand in front of either.** The host named in the app's
 *    entitlement has to be the host that answers, which is what makes www a 301
 *    to the apex in `infra/site.tf` and the apex a real ALIAS record rather than
 *    GoDaddy forwarding.
 *  - **`apple-app-site-association` has no file extension**, so the site's
 *    viewer-request function has to exempt `/.well-known/` from the rewrite that
 *    turns extensionless paths into `index.html` lookups.
 *  - **Content type is `application/json`.** The pages sync in
 *    `infra/deploy-site.sh` forces `text/html` on everything it uploads, so
 *    `.well-known` is excluded from it and pushed by a step of its own.
 *
 * The ids below are the client's, lifted the same way `chrome.ts` lifts the
 * theme values: `eas.json` (`appleTeamId`) and `app.json`
 * (`ios.bundleIdentifier`, `android.package`) in the fridgeezy repo. If either
 * ever changes, this is the copy to update — and the change only takes effect
 * for readers on a build whose entitlement matches.
 */

const APPLE_TEAM_ID = "TQ5JNMSV4D";
const BUNDLE_ID = "com.anonymous.fridgeezy";

/**
 * Paths the app claims. Share links and nothing else.
 *
 * Deliberately narrow: `/privacy`, `/terms` and the landing page should open in
 * a browser. Someone tapping a legal link from the App Store listing, or reading
 * the site before they have the app, is not asking to be thrown into it — and
 * the App Store requires those documents to be readable on the web regardless.
 */
const CLAIMED_PATHS = ["/r/*"];

/**
 * `appIDs` + `components`, not the older `appID` + `paths`. The app's floor is
 * well above iOS 13, where the modern form landed, and mixing both invites the
 * two lists disagreeing.
 *
 * No `webcredentials`: there is no password anywhere in this app — the way in is
 * a six-digit code — so there is nothing for the keychain to offer.
 */
export const appleAppSiteAssociation = () => ({
    applinks: {
        details: [
            {
                appIDs: [`${APPLE_TEAM_ID}.${BUNDLE_ID}`],
                components: CLAIMED_PATHS.map((path) => ({
                    "/": path,
                    comment: "Recipe share links",
                })),
            },
        ],
    },
});

/**
 * Android's half. Needs the SHA-256 of the certificate the installed APK is
 * actually signed with, which for anything installed from Play is **Google's
 * app-signing key, not the upload key** — the commonest way to get this wrong,
 * and the symptom is links that open a browser with no error anywhere.
 *
 * Read it from Play Console → Test and release → App integrity → App signing
 * key certificate, or `npx eas-cli credentials -p android`. A local debug build
 * is signed with its own key, so pass both when testing one, comma-separated.
 *
 * Returns null when `ANDROID_CERT_SHA256` is unset, and the build then writes no
 * file at all. A file holding a wrong or placeholder fingerprint is worse than
 * an absent one: Android caches a failed verification, so it would have to be
 * corrected *and* waited out.
 */
export const assetLinks = () => {
    const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);

    if (fingerprints.length === 0) return null;

    return [
        {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
                namespace: "android_app",
                package_name: BUNDLE_ID,
                sha256_cert_fingerprints: fingerprints,
            },
        },
    ];
};
