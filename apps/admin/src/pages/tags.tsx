import type { AdminTagRow, AdminTagUpdate, Page } from "@fridgeezy/admin-contract";
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
    const toast = useToast();
    const [editing, setEditing] = useState<string>();

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

    const save = async (id: string, patch: AdminTagUpdate) => {
        try {
            await api.patch(`/tags/${id}`, patch);
            setEditing(undefined);
            tags.reload();
            toast.show("ok", "Tag saved.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        }
    };

    return (
        <>
            <Typography variant="h1">Tags</Typography>
            <Typography variant="body2" className="page-lede">
                Cuisines, courses, dish forms and dietary marks. The count is how many
                recipes carry each — a tag on one dish is usually a spelling to merge.
            </Typography>

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
                                <TableCell align="right">Actions</TableCell>
                            </>
                        }
                    >
                        {tags.data?.rows.map((row) =>
                            editing === row.id ? (
                                <TagEditor
                                    key={row.id}
                                    row={row}
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

function TagEditor({
    row,
    onCancel,
    onSave,
}: {
    row: AdminTagRow;
    onCancel: () => void;
    onSave: (patch: AdminTagUpdate) => void;
}) {
    const [name, setName] = useState(row.name);
    const [type, setType] = useState(row.type);

    return (
        <TableRow hover={false}>
            <TableCell colSpan={5} sx={{ background: TOKENS.bgVariant }}>
                <Stack direction="row" spacing={4} sx={{ mb: 4 }} flexWrap="wrap" useFlexGap>
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        helperText="Renaming changes the display name only. What the tag joins on is its canonical id, which is not editable — changing that is a merge."
                        sx={{ flex: 1, minWidth: 260 }}
                    />
                    <TextField
                        select
                        label="Type"
                        value={type}
                        onChange={(event) => setType(event.target.value)}
                        helperText={
                            row.parentName && type !== row.type
                                ? `This tag sits under ${row.parentName}. Changing its type leaves it under a parent of a different kind.`
                                : " "
                        }
                        sx={{ minWidth: 200 }}
                    >
                        {TYPES.map((value) => (
                            <MenuItem key={value} value={value}>
                                {value}
                            </MenuItem>
                        ))}
                    </TextField>
                </Stack>
                <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                    <Button size="small" variant="text" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={() => onSave({ name, type: type as AdminTagUpdate["type"] })}
                    >
                        Save
                    </Button>
                </Box>
            </TableCell>
        </TableRow>
    );
}
