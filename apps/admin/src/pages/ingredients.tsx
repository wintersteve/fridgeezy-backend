import type {
    AdminCategory,
    AdminIngredientRow,
    AdminIngredientUpdate,
    Page,
} from "@fridgeezy/admin-contract";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useToast } from "../components/toast";
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
import { useListParams } from "../lib/use-list-params";
import { useDebounced, useResource } from "../lib/use-resource";
import { TOKENS } from "../theme";

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
    const toast = useToast();
    const [editing, setEditing] = useState<string>();

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

    const save = async (id: string, patch: AdminIngredientUpdate) => {
        try {
            await api.patch(`/ingredients/${id}`, patch);
            setEditing(undefined);
            ingredients.reload();
            toast.show("ok", "Ingredient saved.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        }
    };

    return (
        <>
            <Typography variant="h1">Ingredients</Typography>
            <Typography variant="body2" className="page-lede">
                The catalogue recipes, pantries and shopping lists all join on. Shelf life
                drives how quickly the pantry stops being sure you still have something.
            </Typography>

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
                <CheckFilter
                    checked={missingShelfLife}
                    onChange={(on) => setParam("missingShelfLife", on ? "true" : null)}
                    label="No shelf life"
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
                                <TableCell align="right">Actions</TableCell>
                            </>
                        }
                    >
                        {ingredients.data?.rows.map((row) =>
                                    editing === row.id ? (
                                        <IngredientEditor
                                            key={row.id}
                                            row={row}
                                            categories={categories.data ?? []}
                                            onCancel={() => setEditing(undefined)}
                                            onSave={(patch) => void save(row.id, patch)}
                                        />
                            ) : (
                                <TableRow key={row.id}>
                                    <TableCell>
                                        <div className="cell-title">{row.name}</div>
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
                                    <TableCell align="right">
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={() => setEditing(row.id)}
                                        >
                                            Edit
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        )}
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

const COMPONENT_KINDS = [
    { value: "", label: "Any kind" },
    { value: "dish", label: "Dish (offer to make it)" },
    { value: "prep", label: "Prep" },
    { value: "bought", label: "Bought" },
] as const;

const EDITOR_KINDS = [
    { value: "", label: "Unclassified" },
    { value: "bought", label: "Bought" },
    { value: "prep", label: "Prep" },
    { value: "dish", label: "Dish" },
] as const;

function IngredientEditor({
    row,
    categories,
    onCancel,
    onSave,
}: {
    row: AdminIngredientRow;
    categories: AdminCategory[];
    onCancel: () => void;
    onSave: (patch: AdminIngredientUpdate) => void;
}) {
    const [name, setName] = useState(row.name);
    const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
    const [shelfLife, setShelfLife] = useState(
        row.defaultShelfLifeDays === null ? "" : String(row.defaultShelfLifeDays)
    );
    const [componentKind, setComponentKind] = useState(row.componentKind ?? "");
    const [componentDish, setComponentDish] = useState(row.componentDish ?? "");

    return (
        <TableRow hover={false}>
            <TableCell colSpan={6} sx={{ background: TOKENS.bgVariant }}>
                <Stack direction="row" spacing={4} sx={{ mb: 4 }} flexWrap="wrap" useFlexGap>
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        sx={{ flex: 1, minWidth: 200 }}
                    />
                    <TextField
                        select
                        label="Category"
                        value={categoryId}
                        onChange={(event) => setCategoryId(event.target.value)}
                        sx={{ minWidth: 180 }}
                    >
                        <MenuItem value="">—</MenuItem>
                        {categories.map((category) => (
                            <MenuItem key={category.id} value={category.id}>
                                {category.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label="Shelf life (days)"
                        type="number"
                        value={shelfLife}
                        onChange={(event) => setShelfLife(event.target.value)}
                        placeholder="30 (fallback)"
                        slotProps={{ htmlInput: { min: 0 } }}
                        sx={{ width: 150 }}
                    />
                    <TextField
                        select
                        label="Component kind"
                        value={componentKind}
                        onChange={(event) => setComponentKind(event.target.value)}
                        sx={{ minWidth: 170 }}
                    >
                        {EDITOR_KINDS.map((kind) => (
                            <MenuItem key={kind.value} value={kind.value}>
                                {kind.label}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label="Dish to open"
                        value={componentDish}
                        onChange={(event) => setComponentDish(event.target.value)}
                        placeholder="Béchamel"
                        disabled={componentKind !== "dish"}
                        sx={{ minWidth: 180 }}
                    />
                </Stack>
                <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                    <Button size="small" variant="text" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={() =>
                            onSave({
                                name,
                                categoryId: categoryId || null,
                                defaultShelfLifeDays: shelfLife ? Number(shelfLife) : null,
                                componentKind:
                                    (componentKind || null) as AdminIngredientUpdate["componentKind"],
                                // Only meaningful for `dish`, and cleared with
                                // the kind so a downgraded row does not keep
                                // pointing at a dish nothing will open.
                                componentDish:
                                    componentKind === "dish" ? componentDish || null : null,
                            })
                        }
                    >
                        Save
                    </Button>
                </Box>
            </TableCell>
        </TableRow>
    );
}
