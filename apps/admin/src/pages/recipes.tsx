import type { AdminRecipeRow, Page } from "@fridgeezy/admin-contract";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Link } from "react-router-dom";


import {
    CheckFilter,
    DataTable,
    FilterBar,
    FilterSelect,
    Pager,
    Pill,
    ResourceState,
    SearchField,
    SortTh,
} from "../components/ui";
import { api, queryString } from "../lib/api";
import { formatDate, formatMinutes } from "../lib/format";
import { useListParams } from "../lib/use-list-params";
import { useDebounced, useResource } from "../lib/use-resource";
import { TOKENS } from "../theme";

const PAGE_SIZE = 50;

/**
 * The catalogue.
 *
 * ## The filters live in the URL
 *
 * `useSearchParams` rather than `useState`, so the overview's "3 dishes have no
 * picture" tile can link straight to this list already narrowed — which is the
 * whole shape of that screen — and so a filtered view can be reloaded or kept
 * in a tab. The alternative is a set of props threaded from a parent that does
 * not exist.
 *
 * ## The search term is debounced; the dropdowns are not
 *
 * Typing fires a request per keystroke otherwise. A select changes once per
 * decision, so delaying it would only make it feel slow.
 *
 * ## The sort is the table's own headers, and the dropdown is gone
 *
 * Two controls for one question is two places to look and one of them to keep
 * in step. The header is where a reader reaches for this anyway, and it says
 * which column is sorted and which way in the place the answer is — where a
 * select saying "Most saved" sits in a filter bar above a column called
 * "Saved" and leaves the two to be matched up by eye.
 */
export function RecipesPage() {
    const { params, get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "createdAt",
        dir: "desc",
    });

    const query = get("query");
    const visibility = get("visibility", "visible");
    const difficulty = get("difficulty");
    const missingImage = params.get("missingImage") === "true";
    const unreachableImage = params.get("unreachableImage") === "true";

    const debouncedQuery = useDebounced(query);

    const recipes = useResource(
        () =>
            api.get<Page<AdminRecipeRow>>(
                `/recipes${queryString({
                    query: debouncedQuery,
                    visibility,
                    difficulty,
                    missingImage: missingImage || undefined,
                    unreachableImage: unreachableImage || undefined,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [
            debouncedQuery,
            visibility,
            difficulty,
            missingImage,
            unreachableImage,
            sort,
            dir,
            offset,
        ]
    );

    return (
        <>
            <Typography variant="h1">Recipes</Typography>
            <Typography variant="body2" className="page-lede">
                Everything readers can find, plus everything you have pulled. Hiding a dish
                removes it from every read path; deleting one is permanent.
            </Typography>

            <FilterBar count={recipes.data ? `${recipes.data.total} matching` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search recipes"
                />
                <FilterSelect
                    value={visibility}
                    onChange={(value) => setParam("visibility", value)}
                    label="Visibility"
                    options={VISIBILITY}
                />
                <FilterSelect
                    value={difficulty}
                    onChange={(value) => setParam("difficulty", value)}
                    label="Difficulty"
                    options={LEVELS}
                />
                <CheckFilter
                    checked={missingImage}
                    onChange={(on) => setParam("missingImage", on ? "true" : null)}
                    label="No illustration"
                />
                {/* Separate from "No illustration" because they look the same
                    to a reader and are opposite jobs: that one needs a
                    generation, this one needs a URL rewritten — the art is
                    already in the bucket. */}
                <CheckFilter
                    checked={unreachableImage}
                    onChange={(on) => setParam("unreachableImage", on ? "true" : null)}
                    label="Unreachable image host"
                />
            </FilterBar>

            <Paper>
                <ResourceState
                    loading={recipes.loading}
                    fetching={recipes.fetching}
                    error={recipes.error}
                    empty={recipes.data?.rows.length === 0}
                    emptyTitle="No recipes match"
                    emptyLine="Widen the search, or switch visibility to All."
                >
                    <DataTable
                        head={
                            <>
                                <TableCell className="col-thumb">Art</TableCell>
                                <SortTh
                                    column="name"
                                    label="Dish"
                                    sort={sort}
                                    dir={dir}
                                    onSort={setSort}
                                />
                                {/* Level, Time and State are plain cells: the
                                    API cannot order by them, and a header that
                                    sorted the fifty rows in view would claim to
                                    have sorted four hundred. */}
                                <TableCell>Level</TableCell>
                                <TableCell align="right">Time</TableCell>
                                <SortTh
                                    column="favouriteCount"
                                    label="Saved"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    align="right"
                                    onSort={setSort}
                                />
                                <TableCell>State</TableCell>
                                <SortTh
                                    column="createdAt"
                                    label="Added"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    onSort={setSort}
                                />
                            </>
                        }
                    >
                        {recipes.data?.rows.map((recipe) => (
                            <RecipeRow key={recipe.id} recipe={recipe} />
                        ))}
                    </DataTable>
                    <Pager
                        total={recipes.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>
        </>
    );
}

/** `""` carries a label because it is a real choice, not an absent one. */
const VISIBILITY = [
    { value: "visible", label: "Visible" },
    { value: "hidden", label: "Hidden" },
    { value: "all", label: "All" },
] as const;

const LEVELS = [
    { value: "", label: "Any level" },
    { value: "easy", label: "Easy" },
    { value: "medium", label: "Medium" },
    { value: "hard", label: "Hard" },
] as const;

function RecipeRow({ recipe }: { recipe: AdminRecipeRow }) {
    // Per row, because a broken URL is a property of one picture. A dish whose
    // `image` is a predicted URL the upload never reached looks identical to
    // one with no URL at all until the browser tries to load it.
    const [broken, setBroken] = useState(false);

    return (
        <TableRow>
            <TableCell>
                {recipe.image && !broken ? (
                    <img
                        className="thumb"
                        src={recipe.image}
                        alt=""
                        loading="lazy"
                        onError={() => setBroken(true)}
                    />
                ) : (
                    <div className="thumb empty">{broken ? "404" : "—"}</div>
                )}
            </TableCell>
            <TableCell>
                <Link to={`/recipes/${recipe.id}`} className="dish">
                    {recipe.name}
                </Link>
                <Typography variant="caption" component="div" sx={{ color: TOKENS.inkMuted }}>
                    {[recipe.identityCuisine, recipe.nameEn !== recipe.name ? recipe.nameEn : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                </Typography>
            </TableCell>
            <TableCell>{recipe.difficulty ?? "—"}</TableCell>
            <TableCell align="right">{formatMinutes(recipe.totalTimeMinutes)}</TableCell>
            <TableCell align="right">{recipe.favouriteCount}</TableCell>
            <TableCell>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {recipe.hiddenAt ? (
                        <Pill tone="hidden">Hidden</Pill>
                    ) : (
                        <Pill tone="live">Live</Pill>
                    )}
                    {/* A version and an import are both rows a reader owns
                        rather than catalogue entries, and both behave
                        differently under every control on the detail page — so
                        they are marked here rather than explained there. */}
                    {recipe.baseRecipeId ? <Pill tone="info">Version</Pill> : null}
                    {recipe.createdBy ? <Pill tone="rose">Private</Pill> : null}
                </Stack>
            </TableCell>
            <TableCell sx={{ color: TOKENS.inkMuted, whiteSpace: "nowrap" }}>
                {formatDate(recipe.createdAt)}
            </TableCell>
        </TableRow>
    );
}
