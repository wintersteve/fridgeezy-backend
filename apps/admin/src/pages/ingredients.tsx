import type {
    AdminCategory,
    AdminIngredientRow,
    Page,
} from "@fridgeezy/admin-contract";
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

/**
 * The ingredient catalogue — the table everything else joins on.
 *
 * ## Editing happens IN the row, not on a page of its own
 *
 * An ingredient has four editable fields and no children. A detail route for
 * that is a navigation each way to change one number, on the screen most likely
 * to be used for a long pass of small corrections. So a row expands into its
 * own form and collapses again, and the list never moves under the cursor.
 *
 * ## The two "unfinished" filters are the point of the screen
 *
 * Shelf life drives the pantry's confidence decay: a row without one falls back
 * to a flat thirty days, which treats spinach like cumin. Component kind
 * decides whether a recipe offers to make an ingredient rather than buy it,
 * where a wrong `dish` is much worse than a missing one — it offers to make soy
 * sauce.
 */
export function IngredientsPage() {
    const { params, get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "useCount",
        dir: "desc",
    });

    const query = get("query");
    const componentKind = get("componentKind");
    const categoryId = get("categoryId");
    const missingShelfLife = params.get("missingShelfLife") === "true";

    const debouncedQuery = useDebounced(query);

    const categories = useResource(() => api.get<AdminCategory[]>("/categories"), []);

    const ingredients = useResource(
        () =>
            api.get<Page<AdminIngredientRow>>(
                `/ingredients${queryString({
                    query: debouncedQuery,
                    componentKind,
                    categoryId,
                    missingShelfLife: missingShelfLife || undefined,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [debouncedQuery, componentKind, categoryId, missingShelfLife, sort, dir, offset]
    );


    return (
        <>
            <PageHead
                title="Ingredients"
                lede="The catalogue recipes, pantries and shopping lists all join on. Shelf life drives how quickly the pantry stops being sure you still have something."
            />

            <FilterBar count={ingredients.data ? `${ingredients.data.total} matching` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search ingredients"
                />
                <FilterSelect
                    value={categoryId}
                    onChange={(value) => setParam("categoryId", value)}
                    label="Category"
                    width={200}
                    options={[
                        { value: "", label: "Any category" },
                        ...(categories.data ?? []).map((category) => ({
                            value: category.id,
                            label: `${category.name} (${category.ingredientCount})`,
                        })),
                    ]}
                />
                <FilterSelect
                    value={componentKind}
                    onChange={(value) => setParam("componentKind", value)}
                    label="Component kind"
                    width={200}
                    options={COMPONENT_KINDS}
                />
                <FilterSelect
                    value={missingShelfLife ? "true" : ""}
                    onChange={(value) => setParam("missingShelfLife", value || null)}
                    label="Shelf life"
                    width={190}
                    options={SHELF_LIFE}
                />
            </FilterBar>

            <Paper>
                <ResourceState
                    loading={ingredients.loading}
                    fetching={ingredients.fetching}
                    error={ingredients.error}
                    empty={ingredients.data?.rows.length === 0}
                    emptyTitle="No ingredients match"
                >
                    <DataTable
                        head={
                            <>
                                <SortTh
                                    column="name"
                                    label="Ingredient"
                                    sort={sort}
                                    dir={dir}
                                    onSort={setSort}
                                />
                                <TableCell>Category</TableCell>
                                <SortTh
                                    column="useCount"
                                    label="Used in"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    align="right"
                                    onSort={setSort}
                                />
                                {/* Shelf life and Component have no server sort
                                    — the working list for both is the checkbox
                                    above, which is the question anybody
                                    actually asks of them. */}
                                <TableCell align="right">Shelf life</TableCell>
                                <TableCell>Component</TableCell>
                            </>
                        }
                    >
                        {ingredients.data?.rows.map((row) => (
                                <LinkRow key={row.id} to={`/ingredients/${row.id}`}>
                                    <TableCell>
                                        <Link
                                            to={`/ingredients/${row.id}`}
                                            className="cell-title"
                                        >
                                            {row.name}
                                        </Link>
                                        {row.aliases.length ? (
                                            <Typography
                                                variant="caption"
                                                component="div"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                also: {row.aliases.slice(0, 3).join(", ")}
                                                {row.aliases.length > 3
                                                    ? ` +${row.aliases.length - 3}`
                                                    : ""}
                                            </Typography>
                                        ) : null}
                                    </TableCell>
                                    <TableCell sx={{ color: TOKENS.inkMuted }}>
                                        {row.categoryName ?? "—"}
                                    </TableCell>
                                    <TableCell align="right">{row.useCount}</TableCell>
                                    <TableCell
                                        align="right"
                                        sx={
                                            row.defaultShelfLifeDays === null
                                                ? { color: TOKENS.inkMuted }
                                                : undefined
                                        }
                                    >
                                        {row.defaultShelfLifeDays === null
                                            ? "not set"
                                            : `${row.defaultShelfLifeDays}d`}
                                    </TableCell>
                                    <TableCell>
                                        {row.componentKind === "dish" ? (
                                            <Pill tone="accent">
                                                make: {row.componentDish ?? row.name}
                                            </Pill>
                                        ) : row.componentKind ? (
                                            <Pill>{row.componentKind}</Pill>
                                        ) : (
                                            <Typography
                                                variant="caption"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                unclassified
                                            </Typography>
                                        )}
                                    </TableCell>
                                </LinkRow>
                        ))}
                    </DataTable>
                    <Pager
                        total={ingredients.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>
        </>
    );
}

/** Two options, for the reason `ILLUSTRATION` records on the recipes page. */
const SHELF_LIFE = [
    { value: "", label: "Any shelf life" },
    { value: "true", label: "No shelf life" },
] as const;

const COMPONENT_KINDS = [
    { value: "", label: "Any kind" },
    { value: "dish", label: "Dish (offer to make it)" },
    { value: "prep", label: "Prep" },
    { value: "bought", label: "Bought" },
] as const;


