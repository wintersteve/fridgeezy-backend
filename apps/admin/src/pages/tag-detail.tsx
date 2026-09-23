import {
    TAG_TYPES,
    type AdminTagDetail,
    type AdminTagUpdate,
} from "@fridgeezy/admin-contract";
import { Muted, Pill } from "@fridgeezy/design";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useToast } from "../components/toast";
import {
    DetailLayout,
    DetailPage,
    Fact,
    Facts,
    PageHead,
    ResourceState,
    SaveBar,
} from "../components/ui";
import { api } from "../lib/api";
import { useResource } from "../lib/use-resource";

/**
 * One tag.
 *
 * ## The recipe list is the page's argument
 *
 * A tag's count is the only honest measure of whether it earns a row, and the
 * NAMES behind that count are what tell a real cuisine from a spelling to
 * merge. "japanese 18" and "japenese 1" are identical as figures and nothing
 * alike as lists — and the second is a tag to fold into the first, which is a
 * judgement nobody can make from a table cell.
 */
export function TagDetailPage() {
    const { id = "" } = useParams();
    const toast = useToast();

    const tag = useResource(() => api.get<AdminTagDetail>(`/tags/${id}`), [id]);

    const [form, setForm] = useState<AdminTagUpdate>({});
    const [busy, setBusy] = useState(false);

    useEffect(() => setForm({}), [id]);

    const data = tag.data;

    const value = <K extends keyof AdminTagUpdate>(
        key: K,
        fallback: AdminTagUpdate[K]
    ): AdminTagUpdate[K] => (key in form ? form[key] : fallback);

    const save = async () => {
        if (!data) return;

        setBusy(true);

        try {
            await api.patch(`/tags/${data.id}`, form);
            setForm({});
            tag.reload();
            toast.show("ok", "Saved.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const typeChanged = data
        ? (value("type", data.type) ?? data.type) !== data.type
        : false;

    return (
        <DetailPage backTo="/tags" backLabel="Tags">
            <ResourceState loading={tag.loading} error={tag.error}>
                {data ? (
                    <>
                        <PageHead
                            title={data.name}
                            lede={
                                <>
                                    <Pill tone="info">{data.type}</Pill>
                                    <span>
                                        {data.recipeCount} recipe
                                        {data.recipeCount === 1 ? "" : "s"}
                                    </span>
                                </>
                            }
                        />

                        <DetailLayout
                            main={
                                <>
                                    <Paper className="pad">
                                        <h2>Details</h2>
                                        <Stack spacing={4}>
                                            <TextField
                                                fullWidth
                                                label="Name"
                                                value={
                                                    value("name", data.name) ??
                                                    ""
                                                }
                                                onChange={(event) =>
                                                    setForm((f) => ({
                                                        ...f,
                                                        name: event.target
                                                            .value,
                                                    }))
                                                }
                                                helperText="Renaming changes the display name only. What the tag joins on is its canonical id, which is not editable — changing that is a merge."
                                            />
                                            <TextField
                                                select
                                                label="Type"
                                                value={
                                                    value("type", data.type) ??
                                                    data.type
                                                }
                                                onChange={(event) =>
                                                    setForm((f) => ({
                                                        ...f,
                                                        type: event.target
                                                            .value as AdminTagUpdate["type"],
                                                    }))
                                                }
                                                sx={{ maxWidth: 240 }}
                                            >
                                                {TAG_TYPES.map((type) => (
                                                    <MenuItem
                                                        key={type}
                                                        value={type}
                                                    >
                                                        {type}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            {/* `find_recipes` walks a tag SUBTREE, so a
                                            type change takes everything under this
                                            tag with it — and a cuisine sitting under
                                            a course is a branch that matches
                                            nothing. The warning names the children
                                            because the count alone does not say
                                            what moves. */}
                                            {typeChanged &&
                                            data.children.length > 0 ? (
                                                <Alert severity="warning">
                                                    {data.children.length} tag
                                                    {data.children.length === 1
                                                        ? ""
                                                        : "s"}{" "}
                                                    sit under this one and will
                                                    keep it as a parent:{" "}
                                                    {data.children
                                                        .map(
                                                            (child) =>
                                                                child.name
                                                        )
                                                        .join(", ")}
                                                    . A subtree of a different
                                                    kind matches nothing.
                                                </Alert>
                                            ) : null}
                                            {typeChanged && data.parentName ? (
                                                <Alert severity="warning">
                                                    This tag sits under{" "}
                                                    <strong>
                                                        {data.parentName}
                                                    </strong>
                                                    . Changing its type leaves
                                                    it under a parent of a
                                                    different kind.
                                                </Alert>
                                            ) : null}
                                        </Stack>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Recipes ({data.recipeCount})</h2>
                                        {data.recipes.length === 0 ? (
                                            <Muted>
                                                Nothing carries this tag. A tag
                                                on no dish is usually a spelling
                                                to merge, or a vocabulary entry
                                                nothing has used yet.
                                            </Muted>
                                        ) : (
                                            <Stack spacing={2}>
                                                {data.recipes.map((dish) => (
                                                    <Box key={dish.id}>
                                                        <Link
                                                            to={`/recipes/${dish.id}`}
                                                            className="dish"
                                                        >
                                                            {dish.name}
                                                        </Link>{" "}
                                                        {dish.hiddenAt ? (
                                                            <Pill tone="hidden">
                                                                Hidden
                                                            </Pill>
                                                        ) : null}
                                                    </Box>
                                                ))}
                                                {data.recipeCount >
                                                data.recipes.length ? (
                                                    <Muted>
                                                        …and{" "}
                                                        {data.recipeCount -
                                                            data.recipes
                                                                .length}{" "}
                                                        more
                                                    </Muted>
                                                ) : null}
                                            </Stack>
                                        )}
                                    </Paper>
                                </>
                            }
                            aside={
                                <>
                                    <Paper className="pad">
                                        <h2>Record</h2>
                                        <Facts>
                                            <Fact label="Type">
                                                {data.type}
                                            </Fact>
                                            <Fact label="Parent">
                                                {data.parentName ?? "—"}
                                            </Fact>
                                            <Fact label="Recipes">
                                                {data.recipeCount}
                                            </Fact>
                                            <Fact label="Id">
                                                <span className="mono">
                                                    {data.id}
                                                </span>
                                            </Fact>
                                        </Facts>
                                    </Paper>

                                    {data.aliases.length > 0 ? (
                                        <Paper className="pad">
                                            <h2>Aliases</h2>
                                            <div className="tag-list">
                                                {data.aliases.map((alias) => (
                                                    <Pill key={alias}>
                                                        {alias}
                                                    </Pill>
                                                ))}
                                            </div>
                                        </Paper>
                                    ) : null}

                                    {data.children.length > 0 ? (
                                        <Paper className="pad">
                                            <h2>Under this tag</h2>
                                            <Facts>
                                                {data.children.map((child) => (
                                                    <Fact
                                                        key={child.id}
                                                        label={child.name}
                                                    >
                                                        <Link
                                                            to={`/tags/${child.id}`}
                                                        >
                                                            {child.recipeCount}
                                                        </Link>
                                                    </Fact>
                                                ))}
                                            </Facts>
                                        </Paper>
                                    ) : null}
                                </>
                            }
                        />

                        <SaveBar
                            count={Object.keys(form).length}
                            busy={busy}
                            onDiscard={() => setForm({})}
                            onSave={() => void save()}
                        />
                    </>
                ) : null}
            </ResourceState>
        </DetailPage>
    );
}
