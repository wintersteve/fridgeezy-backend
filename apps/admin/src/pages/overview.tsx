import type { AdminOverview } from "@fridgeezy/admin-contract";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import { Link } from "react-router-dom";


/**
 * The opening screen: what is in the catalogue, and what is wrong with it.
 *
 * ## A number is either a FACT or a JOB, and they are drawn differently
 *
 * A total is a plain tile. A defect count — hidden dishes, recipes with no
 * picture, ingredients the shelf-life backfill never reached — is a LINK into
 * the list already filtered to exactly those rows, so the screen is a set of
 * doors into work rather than a dashboard to admire. A defect count that
 * happens to be zero keeps its tile and loses its accent: "nothing to do here"
 * is worth seeing, and a tile that disappears takes the reassurance with it.
 */
export function OverviewPage({
    overview,
    error,
}: {
    overview: AdminOverview | undefined;
    error?: string;
}) {
    if (!overview) {
        return (
            <>
                <h1>Overview</h1>
                {/* Three states, not two. A failed read used to fall through to
                    "Loading…" and stay there, which reads as a hung console
                    rather than as an API that cannot be reached. */}
                {error ? (
                    <Alert severity="error">{error}</Alert>
                ) : (
                    <p className="page-lede">Loading…</p>
                )}
            </>
        );
    }

    const job = (
        label: string,
        value: number,
        to: string,
        note: string,
        clearNote: string
    ) => (
        <Link key={label} to={to} className={`card stat ${value === 0 ? "clear" : ""}`}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
            <div className="note">{value === 0 ? clearNote : note}</div>
        </Link>
    );

    const fact = (label: string, value: number, note: string) => (
        <div key={label} className="card stat">
            <div className="label">{label}</div>
            <div className="value">{value}</div>
            <div className="note">{note}</div>
        </div>
    );

    const usage = Object.entries(overview.usage).sort((a, b) => b[1] - a[1]);

    return (
        <>
            <h1>Overview</h1>
            <p className="page-lede">
                What is in the catalogue, and what is waiting on you. Every figure in the
                second row is a list you can open.
            </p>

            <div className="grid cols-4 section-block">
                {fact("Dishes", overview.recipes.dishes, `${overview.recipes.total} rows including versions`)}
                {fact("Suggestions", overview.suggestions.total, `${overview.suggestions.unpromoted} never promoted`)}
                {fact("Ingredients", overview.ingredients.total, "the catalogue everything joins on")}
                {fact("Accounts", overview.users.total, `${overview.users.subscribers} subscribed · ${overview.users.recent} new this month`)}
            </div>

            <h2 className="block-heading">Needs attention</h2>
            <div className="grid cols-4">
                {job(
                    "Hidden dishes",
                    overview.recipes.hidden,
                    "/recipes?visibility=hidden",
                    "pulled from every read path",
                    "nothing is withheld"
                )}
                {job(
                    "No illustration",
                    overview.recipes.missingImage,
                    "/recipes?missingImage=true",
                    "regenerate to give them one",
                    "every dish has art"
                )}
                {job(
                    "Unreachable art",
                    overview.recipes.unreachableImage,
                    "/recipes?unreachableImage=true",
                    "art exists but the URL host is private — run repair-image-urls",
                    "every picture is on a public host"
                )}
                {job(
                    "No shelf life",
                    overview.ingredients.missingShelfLife,
                    "/ingredients?missingShelfLife=true",
                    "these decay on the flat 30-day fallback",
                    "every ingredient has a clock"
                )}
                {job(
                    "Hidden ideas",
                    overview.suggestions.hidden,
                    "/suggestions?visibility=hidden",
                    "withheld from the feed",
                    "nothing is withheld"
                )}
            </div>

            <h2 className="block-heading">AI calls, last 7 days</h2>
            <Paper className="pad">
                {usage.length === 0 ? (
                    <p className="card-note">
                        Nothing in the last week.
                    </p>
                ) : (
                    <dl>
                        {usage.map(([bucket, count]) => (
                            <div className="kv" key={bucket}>
                                {/* The buckets run ACROSS the features rather
                                    than along them — three nouns a cook
                                    recognises against eight capabilities they
                                    do not — so they are shown as they are
                                    stored rather than mapped to route names. */}
                                <dt>{bucket}</dt>
                                <dd>{count}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </Paper>
        </>
    );
}
