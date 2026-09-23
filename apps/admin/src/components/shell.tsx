import type { AdminOverview } from "@fridgeezy/admin-contract";
import Button from "@mui/material/Button";
import type { Session } from "@supabase/supabase-js";
import { NavLink, Outlet } from "react-router-dom";


import { supabase } from "../lib/supabase";

/**
 * The frame every page is drawn in.
 *
 * ## The sidebar counts are DEFECTS, never totals
 *
 * "Recipes 54" in a navigation rail is a number that never changes and teaches
 * the reader to stop looking at it. What is beside each row here is how many
 * things in that section want attention — hidden dishes, ingredients with no
 * shelf life — so the rail answers "where is there work" before anything is
 * clicked, and is blank when there is none.
 *
 * ## Three groups, named for what they ARE rather than what they are stored in
 *
 * **Insights** reports, **Catalogue** is the shared corpus a reader sees, and
 * **Operations** is work that costs something to run. Accounts sits on its own
 * because a person is not catalogue content and filing them together is how a
 * tool starts treating readers as rows.
 *
 * "Catalogue" rather than "Entities" or "Database" on purpose: those are
 * implementation vocabulary, and the app already has a word for this — the
 * shared corpus of dishes every reader draws from. A console that names things
 * after their tables teaches its reader the schema instead of the product.
 *
 * ## The rail stays hand-drawn where the rest of the console is MUI
 *
 * It is LAYOUT — a grid column, a wordmark, a set of links with an active
 * state — rather than a set of controls, and MUI's `Drawer`/`List` would have
 * to be themed back to exactly this to look the same. The one thing in here
 * that IS a control, the sign-out button, is the library's.
 */
export function Shell({
    session,
    overview,
}: {
    session: Session;
    overview: AdminOverview | undefined;
}) {
    const needsAttention = (count: number | undefined) =>
        count && count > 0 ? <span className="badge">{count}</span> : null;

    return (
        <div className="shell">
            <nav className="sidebar">
                <div className="wordmark">
                    Fridge<span>ezy</span>
                </div>
                <div className="wordmark-sub">Admin</div>

                <div className="nav-group">Insights</div>
                <NavLink to="/" end className="nav-link">
                    Overview
                </NavLink>

                <div className="nav-group">Catalogue</div>
                <NavLink to="/recipes" className="nav-link">
                    Recipes
                    {needsAttention(
                        (overview?.recipes.hidden ?? 0) +
                            (overview?.recipes.missingImage ?? 0) +
                            (overview?.recipes.unreachableImage ?? 0)
                    )}
                </NavLink>
                <NavLink to="/suggestions" className="nav-link">
                    Suggestions
                    {needsAttention(overview?.suggestions.hidden)}
                </NavLink>
                <NavLink to="/ingredients" className="nav-link">
                    Ingredients
                    {needsAttention(overview?.ingredients.missingShelfLife)}
                </NavLink>
                <NavLink to="/tags" className="nav-link">
                    Tags
                </NavLink>

                <div className="nav-group">Accounts</div>
                <NavLink to="/users" className="nav-link">
                    Users
                </NavLink>

                <div className="nav-group">Operations</div>
                {/* No count. Everything above reports a DEFECT — something that
                    ought to be fixed — and an undrawn step method is not one:
                    almost no recipe has step art and almost none should, at
                    $0.40-$0.80 a dish. A badge here would read as a backlog. */}
                <NavLink to="/operations/step-art" className="nav-link">
                    Step illustrations
                </NavLink>
                <NavLink to="/operations/techniques" className="nav-link">
                    Technique art
                </NavLink>
                {/* Everything on Upkeep IS a defect, so by the rule above it
                    has earned a badge — and it does not carry one, because the
                    five counts behind it are ten queries and the overview would
                    pay for them on every page of the console to decorate one
                    sidebar row. The page is one click away and reports them all
                    itself. Revisit if anybody starts missing them. */}
                <NavLink to="/operations/upkeep" className="nav-link">
                    Upkeep
                </NavLink>

                <div className="sidebar-foot">
                    <div className="who">{session.user.email}</div>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => void supabase.auth.signOut()}
                    >
                        Sign out
                    </Button>
                </div>
            </nav>

            <main className="main">
                <Outlet />
            </main>
        </div>
    );
}
