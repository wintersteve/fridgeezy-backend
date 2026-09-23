import type { AdminTagRow, Page } from "@fridgeezy/admin-contract";
import { TOKENS } from "@fridgeezy/design";
import Paper from "@mui/material/Paper";
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
import { useListParams } from "../lib/use-list-params";
import { useDebounced, useResource } from "../lib/use-resource";

const PAGE_SIZE = 50;

const TYPES = ["cuisine", "course", "dish_form", "dietary", "component"] as const;

/**
 * The taxonomy.
 *
 * ## Sorted by how many recipes carry each, by default
 *
 * The distribution is lopsided on purpose — roughly 170 cuisines against 4
 * courses — and the number is the only way to tell a real cuisine from one the
 * generator invented for a single dish. A tag on one recipe is a candidate for
 * a rename or a merge; a tag on none is noise.
 *
 * ## `type` is editable and it is the field to be careful with
 *
 * It decides which dimension a tag filters in, and `find_recipes` walks a tag
 * SUBTREE — so moving a tag between types while it keeps a parent leaves a
 * cuisine hanging under a course. Both are shown together for that reason,
 * rather than one being cleared silently when the other changes.
 */
export function TagsPage() {
    const { get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "recipeCount",
        dir: "desc",
    });

    const query = get("query");
    const type = get("type");

    const debouncedQuery = useDebounced(query);

    const tags = useResource(
        () =>
            api.get<Page<AdminTagRow>>(
                `/tags${queryString({
                    query: debouncedQuery,
                    type,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [debouncedQuery, type, sort, dir, offset]
    );


    return (
        <>
            <PageHead
                title="Tags"
                lede="Cuisines, courses, dish forms and dietary marks. The count is how many recipes carry each — a tag on one dish is usually a spelling to merge."
            />

            <FilterBar count={tags.data ? `${tags.data.total} tags` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search tags"
                />
                <FilterSelect
                    value={type}
                    onChange={(value) => setParam("type", value)}
                    label="Type"
                    options={TYPE_OPTIONS}
                />
            </FilterBar>

            <Paper>
                <ResourceState
                    loading={tags.loading}
                    fetching={tags.fetching}
                    error={tags.error}
                    empty={tags.data?.rows.length === 0}
                    emptyTitle="No tags match"
                >
                    <DataTable
                        head={
                            <>
                                <SortTh
                                    column="name"
                                    label="Tag"
                                    sort={sort}
                                    dir={dir}
                                    onSort={setSort}
                                />
                                <TableCell>Type</TableCell>
                                <TableCell>Parent</TableCell>
                                <SortTh
                                    column="recipeCount"
                                    label="Recipes"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    align="right"
                                    onSort={setSort}
                                />
                            </>
                        }
                    >
                        {tags.data?.rows.map((row) => (
                                <LinkRow key={row.id} to={`/tags/${row.id}`}>
                                    <TableCell>
                                        <Link to={`/tags/${row.id}`} className="cell-title">
                                            {row.name}
                                        </Link>
                                        {row.aliases.length ? (
                                            <Typography
                                                variant="caption"
                                                component="div"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                also: {row.aliases.slice(0, 3).join(", ")}
                                            </Typography>
                                        ) : null}
                                    </TableCell>
                                    <TableCell>
                                        <Pill tone="info">{row.type}</Pill>
                                    </TableCell>
                                    <TableCell sx={{ color: TOKENS.inkMuted }}>
                                        {row.parentName ?? "—"}
                                    </TableCell>
                                    <TableCell
                                        align="right"
                                        sx={row.recipeCount === 0 ? { color: TOKENS.inkMuted } : undefined}
                                    >
                                        {row.recipeCount}
                                    </TableCell>
                                </LinkRow>
                        ))}
                    </DataTable>
                    <Pager
                        total={tags.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>
        </>
    );
}

/** `""` is a real choice and carries its own label. */
const TYPE_OPTIONS = [
    { value: "", label: "Any type" },
    ...TYPES.map((value) => ({ value, label: value })),
];

