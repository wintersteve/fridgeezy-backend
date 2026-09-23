import type { AdminSuggestionRow, Page } from "@fridgeezy/admin-contract";
import { TOKENS } from "@fridgeezy/design";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import Typography from "@mui/material/Typography";
import { Link } from "react-router-dom";

import {
    DataTable,
    FilterBar,
    FilterSelect,
    LinkRow,
    PageHead,
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

const PAGE_SIZE = 50;

/**
 * Dish IDEAS — a name, a gloss and an ingredient list, with no method behind
 * them until one is promoted.
 *
 * There are far more of these than recipes, which is a fact about the product
 * rather than a backlog: the feed generates ideas ambiently, and the client
 * caps how many it shows for exactly that reason. So the useful work here is
 * not reviewing them one by one — it is pulling the ones that are wrong, and
 * clearing the ones that have already become recipes.
 *
 * Deleting is offered where hiding is not the better answer, which is the
 * reverse of the recipes screen. A suggestion has no readers: nothing can
 * favourite one, plan one or shop for one, so there is nothing for a reversible
 * hide to protect.
 */
export function SuggestionsPage() {
    const { get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "createdAt",
        dir: "desc",
    });

    const query = get("query");
    const visibility = get("visibility", "visible");
    const promoted = get("promoted", "any");

    const debouncedQuery = useDebounced(query);

    const suggestions = useResource(
        () =>
            api.get<Page<AdminSuggestionRow>>(
                `/suggestions${queryString({
                    query: debouncedQuery,
                    visibility,
                    promoted,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [debouncedQuery, visibility, promoted, sort, dir, offset]
    );



    return (
        <>
            <PageHead
                title="Suggestions"
                lede="Dish ideas the generator has written. These have no method until somebody promotes one — until then they are a name, a gloss and an ingredient list."
            />

            <FilterBar count={suggestions.data ? `${suggestions.data.total} matching` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search suggestions"
                />
                <FilterSelect
                    value={visibility}
                    onChange={(value) => setParam("visibility", value)}
                    label="Visibility"
                    options={VISIBILITY}
                />
                <FilterSelect
                    value={promoted}
                    onChange={(value) => setParam("promoted", value)}
                    label="Promotion"
                    options={PROMOTION}
                    width={190}
                />
            </FilterBar>

            <Paper>
                <ResourceState
                    loading={suggestions.loading}
                    fetching={suggestions.fetching}
                    error={suggestions.error}
                    empty={suggestions.data?.rows.length === 0}
                    emptyTitle="No ideas match"
                >
                    <DataTable
                        head={
                            <>
                                <SortTh
                                    column="name"
                                    label="Dish"
                                    sort={sort}
                                    dir={dir}
                                    onSort={setSort}
                                />
                                <TableCell>Cuisine</TableCell>
                                <TableCell>Level</TableCell>
                                <TableCell align="right">Time</TableCell>
                                <TableCell>State</TableCell>
                                <SortTh
                                    column="createdAt"
                                    label="Written"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    onSort={setSort}
                                />
                            </>
                        }
                    >
                        {suggestions.data?.rows.map((row) => (
                            <LinkRow key={row.id} to={`/suggestions/${row.id}`}>
                                <TableCell>
                                    <Link to={`/suggestions/${row.id}`} className="dish">
                                        {row.name}
                                    </Link>
                                    {row.description ? (
                                        <Typography
                                            variant="caption"
                                            component="div"
                                            sx={{ color: TOKENS.inkMuted }}
                                        >
                                            {row.description.slice(0, 90)}
                                            {row.description.length > 90 ? "…" : ""}
                                        </Typography>
                                    ) : null}
                                </TableCell>
                                <TableCell sx={{ color: TOKENS.inkMuted }}>
                                    {row.identityCuisine ?? "—"}
                                </TableCell>
                                <TableCell>{row.difficulty ?? "—"}</TableCell>
                                <TableCell align="right">
                                    {formatMinutes(row.totalTimeMinutes)}
                                </TableCell>
                                <TableCell>
                                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                        {row.hiddenAt ? (
                                            <Pill tone="hidden">Hidden</Pill>
                                        ) : (
                                            <Pill tone="live">Live</Pill>
                                        )}
                                        {row.promotedRecipeId ? (
                                            <Link to={`/recipes/${row.promotedRecipeId}`}>
                                                <Pill tone="accent">Promoted</Pill>
                                            </Link>
                                        ) : null}
                                    </Stack>
                                </TableCell>
                                <TableCell sx={{ color: TOKENS.inkMuted, whiteSpace: "nowrap" }}>
                                    {formatDate(row.createdAt)}
                                </TableCell>
                            </LinkRow>
                        ))}
                    </DataTable>
                    <Pager
                        total={suggestions.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>

        </>
    );
}

const VISIBILITY = [
    { value: "visible", label: "Visible" },
    { value: "hidden", label: "Hidden" },
    { value: "all", label: "All" },
] as const;

const PROMOTION = [
    { value: "any", label: "Promoted or not" },
    { value: "promoted", label: "Already a recipe" },
    { value: "unpromoted", label: "Never promoted" },
] as const;
