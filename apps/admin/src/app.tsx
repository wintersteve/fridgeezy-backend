import type { AdminOverview } from "@fridgeezy/admin-contract";
import { CSS_VARIABLES, theme } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import Paper from "@mui/material/Paper";
import { ThemeProvider } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";


import { Shell } from "./components/shell";
import { SignIn } from "./components/sign-in";
import { ToastHost } from "./components/toast";
import { api, ApiError } from "./lib/api";
import { supabase } from "./lib/supabase";
import { IngredientDetailPage } from "./pages/ingredient-detail";
import { IngredientsPage } from "./pages/ingredients";
import { OverviewPage } from "./pages/overview";
import { RecipeDetailPage } from "./pages/recipe-detail";
import { RecipesPage } from "./pages/recipes";
import { StepArtPage } from "./pages/step-art";
import { SuggestionDetailPage } from "./pages/suggestion-detail";
import { SuggestionsPage } from "./pages/suggestions";
import { TagDetailPage } from "./pages/tag-detail";
import { TagsPage } from "./pages/tags";
import { TechniquesPage } from "./pages/techniques";
import { UpkeepPage } from "./pages/upkeep";
import { UserDetailPage } from "./pages/user-detail";
import { UsersPage } from "./pages/users";

/**
 * Three states, and the third is the one worth being careful about.
 *
 * Signed out, signed in AND an admin, and signed in but NOT an admin. The last
 * is not an error to report as a broken page: the account is real and the
 * session is valid, there is simply nothing here for them. It is told plainly
 * and offered the way out.
 *
 * ## The admin check is the OVERVIEW responding, not a claim in the token
 *
 * There is no `is_admin` in the JWT and there should not be — a claim minted at
 * sign-in would keep working after the flag was revoked. `requireAdmin` answers
 * a non-admin 404, and `/admin/overview` is the route that always exists, so
 * the two outcomes of asking for it are the two answers the console needs.
 *
 * ## `HashRouter`, not `BrowserRouter`
 *
 * A single-page app on real paths needs the host to rewrite every unknown path
 * to `index.html`. CloudFront can do that — the site's distribution already
 * runs a function for something similar — and it would mean a deploy of the
 * console and a change to infrastructure staying in step forever. The hash
 * costs an ugly URL on a tool nobody links to, and the console works from a
 * plain S3 bucket with no rewrite rule at all.
 */
export function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [ready, setReady] = useState(false);
    const [overview, setOverview] = useState<AdminOverview>();
    const [overviewError, setOverviewError] = useState<string>();
    const [denied, setDenied] = useState(false);

    useEffect(() => {
        // The restore and the subscription, in that order. `getSession` reads
        // what is already on disk so a reload does not flash the sign-in card
        // at somebody who never signed out.
        void supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setReady(true);
        });

        const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
            // Both cleared on any change: signing out and signing in as
            // somebody else must not leave the previous account's answer behind.
            setOverview(undefined);
            setOverviewError(undefined);
            setDenied(false);
        });

        return () => listener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!session) return;

        api.get<AdminOverview>("/overview")
            .then((result) => {
                setOverview(result);
                setOverviewError(undefined);
            })
            .catch((cause: unknown) => {
                if (cause instanceof ApiError && (cause.status === 404 || cause.status === 401)) {
                    setDenied(true);
                    return;
                }

                // Any other failure is the server being unwell, not a refusal,
                // so the console still loads — every other page fetches for
                // itself and reports its own error. What must NOT happen is the
                // overview sitting on "Loading…" for good, which is what an
                // unreported failure here looked like: a console that appeared
                // to hang rather than one saying the API is unreachable.
                console.error("[admin] overview failed", cause);

                setOverviewError(
                    cause instanceof ApiError
                        ? cause.message
                        : "Could not reach the API — check that it is running and that VITE_BACKEND_URL is right"
                );
            });
    }, [session]);

    if (!ready) {
        return (
            <Shells>
                <Box sx={{ p: 16, textAlign: "center" }}>Loading…</Box>
            </Shells>
        );
    }

    if (!session) {
        return (
            <Shells>
                <SignIn />
            </Shells>
        );
    }

    if (denied) {
        return (
            <Shells>
                <Box className="signin">
                    <Paper sx={{ p: 8, textAlign: "center", maxWidth: 380 }}>
                        <div className="wordmark">
                            Fridge<span>ezy</span>
                        </div>
                        <div className="wordmark-sub">Admin</div>
                        <Typography variant="body2" sx={{ my: 6 }}>
                            <strong>{session.user.email}</strong> is not an admin account.
                        </Typography>
                        <Button variant="outlined" onClick={() => void supabase.auth.signOut()}>
                            Sign out
                        </Button>
                    </Paper>
                </Box>
            </Shells>
        );
    }

    return (
        <Shells>
            <HashRouter>
                <Routes>
                    <Route element={<Shell session={session} overview={overview} />}>
                        <Route
                            index
                            element={<OverviewPage overview={overview} error={overviewError} />}
                        />
                        <Route path="recipes" element={<RecipesPage />} />
                        <Route path="recipes/:id" element={<RecipeDetailPage />} />
                        <Route path="suggestions" element={<SuggestionsPage />} />
                        <Route path="suggestions/:id" element={<SuggestionDetailPage />} />
                        <Route path="ingredients" element={<IngredientsPage />} />
                        <Route path="ingredients/:id" element={<IngredientDetailPage />} />
                        <Route path="tags" element={<TagsPage />} />
                        <Route path="tags/:id" element={<TagDetailPage />} />
                        <Route path="users" element={<UsersPage />} />
                        <Route path="users/:profileId" element={<UserDetailPage />} />
                        <Route path="operations/step-art" element={<StepArtPage />} />
                        <Route path="operations/techniques" element={<TechniquesPage />} />
                        <Route path="operations/upkeep" element={<UpkeepPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </HashRouter>
        </Shells>
    );
}

/**
 * Everything every branch of `App` needs, including the ones that draw no
 * console at all.
 *
 * The sign-in card and the not-an-admin page are rendered BEFORE the router and
 * used to sit outside the providers, which was fine while they were hand-rolled
 * HTML and stops being fine the moment they are MUI: an unthemed `TextField` on
 * the sign-in card is stock Material, so the first screen anybody sees would be
 * the one screen not wearing the product.
 *
 * `CssBaseline` is inside it for the same reason — it is where the page ground
 * and the focus ring come from.
 */
function Shells({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* The custom properties `styles.css` reads, declared from the one
                copy in `@fridgeezy/design` rather than at the top of that file.
                The RECORD and not the string: emotion emits nothing for a raw
                declaration string and every var() resolves to empty. */}
            <GlobalStyles styles={{ ":root": CSS_VARIABLES }} />
            <ToastHost>{children}</ToastHost>
        </ThemeProvider>
    );
}
