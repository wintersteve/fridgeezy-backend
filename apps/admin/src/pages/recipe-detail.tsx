import type {
    AdminRecipeDetail,
    AdminRecipeStep,
    AdminRecipeUpdate,
    RegenerateImageResponse,
} from "@fridgeezy/admin-contract";
import { TOKENS } from "@fridgeezy/design";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useToast } from "../components/toast";
import {
    ConfirmDelete,
    DetailLayout,
    Muted,
    PageHead,
    Pill,
    ResourceState,
} from "../components/ui";
import { api } from "../lib/api";
import { bustCache, formatDateTime } from "../lib/format";
import { useResource } from "../lib/use-resource";

/**
 * One dish: edit it, hide it, repaint it, delete it.
 *
 * ## The form is seeded ONCE, from the fetch, and then it is the reader's
 *
 * A `useEffect` that re-seeds whenever `data` changes would throw away
 * half-typed edits every time anything caused a refetch. It seeds on the id
 * instead, so the only thing that resets the form is navigating to another
 * dish. The same trap the mobile client records on its preference editors.
 *
 * ## Only CHANGED fields are sent
 *
 * The PATCH is partial by design, so the payload is the difference between the
 * form and what was loaded. Sending the whole form would have two curators with
 * the page open overwrite each other's untouched fields — and would rewrite
 * `updated_at` on a dish nobody actually edited.
 */
export function RecipeDetailPage() {
    const { id = "" } = useParams();
    const navigate = useNavigate();

    const recipe = useResource(
        () => api.get<AdminRecipeDetail>(`/recipes/${id}`),
        [id]
    );

    const toast = useToast();
    const [form, setForm] = useState<AdminRecipeUpdate>({});
    const [steps, setSteps] = useState<AdminRecipeStep[] | null>(null);
    const [busy, setBusy] = useState<string>();
    const [artToken, setArtToken] = useState(0);
    const [confirming, setConfirming] = useState(false);
    const [typedName, setTypedName] = useState("");

    useEffect(() => {
        setForm({});
        setSteps(null);
        setArtToken(0);
    }, [id]);

    const data = recipe.data;

    // The form holds only what has been touched; everything else reads through
    // to the loaded row. That is what makes "changed fields" a real set rather
    // than a diff of two near-identical objects.
    const value = <K extends keyof AdminRecipeUpdate>(
        key: K,
        fallback: AdminRecipeUpdate[K]
    ): AdminRecipeUpdate[K] => (key in form ? form[key] : fallback);

    const set = <K extends keyof AdminRecipeUpdate>(
        key: K,
        next: AdminRecipeUpdate[K]
    ) => setForm((current) => ({ ...current, [key]: next }));

    const dirty = Object.keys(form).length > 0;
    const stepsDirty = steps !== null;

    const save = async () => {
        if (!data || !dirty) return;

        setBusy("save");

        try {
            await api.patch(`/recipes/${data.id}`, form);

            const renamed = "name" in form && form.name !== data.name;

            setForm({});
            recipe.reload();
            // The rename case is the one edit with a consequence the reader
            // cannot see: the storage path is derived from the name, so the
            // dish keeps its current picture and the NEXT regeneration writes
            // to a new object. `warn` also buys it longer on screen.
            if (renamed) {
                toast.show(
                    "warn",
                    "Saved. The dish keeps its current illustration — the picture is stored under the old name, and regenerating will paint a new one under the new name."
                );
            } else {
                toast.show("ok", "Saved.");
            }
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    const saveSteps = async () => {
        if (!data || !steps) return;

        setBusy("steps");

        try {
            await api.put(`/recipes/${data.id}/steps`, {
                steps: steps.map((step) => ({
                    instructionText: step.instructionText,
                    title: step.title,
                    durationSeconds: step.durationSeconds,
                    temperatureC: step.temperatureC,
                    equipment: step.equipment,
                    tips: step.tips,
                })),
            });

            setSteps(null);
            recipe.reload();
            toast.show("ok", "Method saved.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    const toggleHidden = async () => {
        if (!data) return;

        const hiding = !data.hiddenAt;

        setBusy("hidden");

        try {
            await api.post(`/recipes/${data.id}/hidden`, {
                hidden: hiding,
                ...(hiding ? { reason: "Hidden from the admin console" } : {}),
            });

            recipe.reload();
            toast.show(
                "ok",
                hiding ? "Hidden from every read path." : "Visible again."
            );
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    const regenerate = async () => {
        if (!data) return;

        setBusy("image");

        try {
            const result = await api.post<RegenerateImageResponse>(
                `/recipes/${data.id}/image`
            );

            // The URL is unchanged by construction, so the browser would draw
            // the picture it is already holding. The token is what makes the
            // new one visible here; nothing is written to `recipes.image`.
            setArtToken(Date.now());
            recipe.reload();
            toast.show(
                "ok",
                result.recipesUpdated > 1
                    ? `Repainted. ${result.recipesUpdated} rows share this picture and all now point at it.`
                    : "Repainted."
            );
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    const remove = async () => {
        if (!data) return;

        setBusy("delete");

        try {
            await api.delete(`/recipes/${data.id}`);
            navigate("/recipes");
        } catch (cause) {
            setConfirming(false);
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    return (
        <>
            <Box sx={{ mb: 3 }}>
                <Link to="/recipes">← Recipes</Link>
            </Box>

            <ResourceState loading={recipe.loading} error={recipe.error}>
                {data ? (
                    <>
                        <PageHead
                            dish
                            title={data.name}
                            lede={
                                <>
                                    {data.hiddenAt ? (
                                        <Pill tone="hidden">
                                            Hidden since{" "}
                                            {formatDateTime(data.hiddenAt)}
                                        </Pill>
                                    ) : (
                                        <Pill tone="live">Live</Pill>
                                    )}
                                    {data.baseRecipeId ? (
                                        <Pill tone="info">Version</Pill>
                                    ) : null}
                                    {data.createdBy ? (
                                        <Pill tone="rose">Private import</Pill>
                                    ) : null}
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
                                                    set(
                                                        "name",
                                                        event.target.value
                                                    )
                                                }
                                                helperText="The illustration is stored under this name. Renaming keeps the current picture and changes where the next regeneration writes."
                                            />
                                            <TextField
                                                fullWidth
                                                label="Short description"
                                                value={
                                                    value(
                                                        "shortDescription",
                                                        data.shortDescription
                                                    ) ?? ""
                                                }
                                                onChange={(event) =>
                                                    set(
                                                        "shortDescription",
                                                        event.target.value ||
                                                            null
                                                    )
                                                }
                                                helperText="The one line under a dish on a card. Around 32 characters fit on one line at card size."
                                            />
                                            <TextField
                                                fullWidth
                                                multiline
                                                minRows={4}
                                                label="Description"
                                                value={
                                                    value(
                                                        "description",
                                                        data.description
                                                    ) ?? ""
                                                }
                                                onChange={(event) =>
                                                    set(
                                                        "description",
                                                        event.target.value ||
                                                            null
                                                    )
                                                }
                                            />
                                            <Stack
                                                direction="row"
                                                spacing={4}
                                                flexWrap="wrap"
                                                useFlexGap
                                            >
                                                <TextField
                                                    select
                                                    label="Level"
                                                    value={
                                                        value(
                                                            "difficulty",
                                                            data.difficulty
                                                        ) ?? ""
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            "difficulty",
                                                            (event.target
                                                                .value ||
                                                                null) as AdminRecipeUpdate["difficulty"]
                                                        )
                                                    }
                                                    sx={{ minWidth: 140 }}
                                                >
                                                    {LEVELS.map((level) => (
                                                        <MenuItem
                                                            key={level.value}
                                                            value={level.value}
                                                        >
                                                            {level.label}
                                                        </MenuItem>
                                                    ))}
                                                </TextField>
                                                <TextField
                                                    label="Servings"
                                                    type="number"
                                                    slotProps={{
                                                        htmlInput: { min: 1 },
                                                    }}
                                                    value={
                                                        value(
                                                            "servings",
                                                            data.servings
                                                        ) ?? 1
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            "servings",
                                                            Number(
                                                                event.target
                                                                    .value
                                                            )
                                                        )
                                                    }
                                                    sx={{ width: 120 }}
                                                />
                                                <TextField
                                                    label="Total minutes"
                                                    type="number"
                                                    slotProps={{
                                                        htmlInput: { min: 0 },
                                                    }}
                                                    value={
                                                        value(
                                                            "totalTimeMinutes",
                                                            data.totalTimeMinutes
                                                        ) ?? ""
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            "totalTimeMinutes",
                                                            event.target.value
                                                                ? Number(
                                                                      event
                                                                          .target
                                                                          .value
                                                                  )
                                                                : null
                                                        )
                                                    }
                                                    sx={{ width: 150 }}
                                                />
                                                <TextField
                                                    label="Identity cuisine"
                                                    value={
                                                        value(
                                                            "identityCuisine",
                                                            data.identityCuisine
                                                        ) ?? ""
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            "identityCuisine",
                                                            event.target
                                                                .value || null
                                                        )
                                                    }
                                                    sx={{
                                                        flex: 1,
                                                        minWidth: 160,
                                                    }}
                                                />
                                            </Stack>
                                            <Stack
                                                direction="row"
                                                spacing={4}
                                                flexWrap="wrap"
                                                useFlexGap
                                            >
                                                {(
                                                    [
                                                        ["kcal", "Calories"],
                                                        [
                                                            "protein",
                                                            "Protein (g)",
                                                        ],
                                                        ["carbs", "Carbs (g)"],
                                                        ["fat", "Fat (g)"],
                                                    ] as const
                                                ).map(([key, label]) => (
                                                    <TextField
                                                        key={key}
                                                        label={label}
                                                        type="number"
                                                        slotProps={{
                                                            htmlInput: {
                                                                min: 0,
                                                            },
                                                        }}
                                                        value={
                                                            value(
                                                                key,
                                                                data[key]
                                                            ) ?? ""
                                                        }
                                                        onChange={(event) =>
                                                            set(
                                                                key,
                                                                event.target
                                                                    .value
                                                                    ? Number(
                                                                          event
                                                                              .target
                                                                              .value
                                                                      )
                                                                    : null
                                                            )
                                                        }
                                                        sx={{
                                                            flex: 1,
                                                            minWidth: 110,
                                                        }}
                                                    />
                                                ))}
                                            </Stack>
                                        </Stack>
                                    </Paper>

                                    <StepsEditor
                                        steps={steps ?? data.steps}
                                        dirty={stepsDirty}
                                        busy={busy === "steps"}
                                        onChange={setSteps}
                                        onSave={saveSteps}
                                        onReset={() => setSteps(null)}
                                    />

                                    <Paper className="pad">
                                        <h2>
                                            Ingredients (
                                            {data.ingredients.length})
                                        </h2>
                                        {/* Read-only, deliberately. An ingredient
                                        row is a JOIN to the ingredient
                                        catalogue with a quantity and a unit,
                                        so editing one here means resolving a
                                        name to an id and a unit to an id —
                                        which is what the generator does with a
                                        model. Getting it wrong writes a recipe
                                        that filters and shops incorrectly. */}
                                        <Table size="small">
                                            <TableBody>
                                                {data.ingredients.map(
                                                    (ingredient) => (
                                                        <TableRow
                                                            key={ingredient.id}
                                                        >
                                                            <TableCell
                                                                sx={{
                                                                    // Wide enough for
                                                                    // "2 tablespoon" on
                                                                    // one line; wrapped,
                                                                    // the amount reads as
                                                                    // two facts.
                                                                    width: 118,
                                                                    whiteSpace:
                                                                        "nowrap",
                                                                    color: TOKENS.inkMuted,
                                                                    verticalAlign:
                                                                        "top",
                                                                }}
                                                            >
                                                                {ingredient.quantity ??
                                                                    ""}{" "}
                                                                {ingredient.unitName ??
                                                                    ""}
                                                            </TableCell>
                                                            <TableCell>
                                                                {
                                                                    ingredient.name
                                                                }
                                                                {ingredient.comment ? (
                                                                    <Muted>
                                                                        {" "}
                                                                        —{" "}
                                                                        {
                                                                            ingredient.comment
                                                                        }
                                                                    </Muted>
                                                                ) : null}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                )}
                                            </TableBody>
                                        </Table>
                                    </Paper>
                                </>
                            }
                            aside={
                                <>
                                    <Paper className="pad">
                                        <h2>Illustration</h2>
                                        {data.image ? (
                                            <img
                                                className="hero-art"
                                                src={bustCache(
                                                    data.image,
                                                    artToken
                                                )}
                                                alt=""
                                            />
                                        ) : (
                                            <Box
                                                sx={{
                                                    py: 8,
                                                    textAlign: "center",
                                                }}
                                            >
                                                <Muted>No illustration</Muted>
                                            </Box>
                                        )}
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            sx={{ mt: 4 }}
                                            disabled={Boolean(busy)}
                                            onClick={() => void regenerate()}
                                        >
                                            {busy === "image"
                                                ? "Painting…"
                                                : "Regenerate illustration"}
                                        </Button>
                                        <Muted>
                                            Costs two image generations and
                                            takes a few seconds. The
                                            better-framed of the two is kept.
                                        </Muted>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Readers</h2>
                                        <dl>
                                            <div className="kv">
                                                <dt>Favourited</dt>
                                                <dd>
                                                    {data.references.favourites}
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>In collections</dt>
                                                <dd>
                                                    {
                                                        data.references
                                                            .collections
                                                    }
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>On shopping lists</dt>
                                                <dd>
                                                    {
                                                        data.references
                                                            .shoppingLists
                                                    }
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>In menus</dt>
                                                <dd>
                                                    {
                                                        data.references
                                                            .menuCourses
                                                    }
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>Reader versions</dt>
                                                <dd>
                                                    {data.references.variants}
                                                </dd>
                                            </div>
                                        </dl>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Visibility</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            {data.hiddenAt
                                                ? "This dish is hidden from search, the feed, pairings, menus and its share link — including for readers who saved it."
                                                : "Hiding removes this dish from every read path, for everyone. It is reversible and nothing is deleted."}
                                        </Typography>
                                        {!data.hiddenAt &&
                                        referenceTotal(data) > 0 ? (
                                            <Alert
                                                severity="warning"
                                                sx={{ mb: 3 }}
                                            >
                                                {referenceTotal(data)} reader
                                                reference
                                                {referenceTotal(data) === 1
                                                    ? ""
                                                    : "s"}{" "}
                                                point at this dish and will
                                                resolve to nothing while it is
                                                hidden.
                                            </Alert>
                                        ) : null}
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            sx={{ mt: 4 }}
                                            disabled={Boolean(busy)}
                                            onClick={() => void toggleHidden()}
                                        >
                                            {busy === "hidden"
                                                ? "Working…"
                                                : data.hiddenAt
                                                  ? "Make visible again"
                                                  : "Hide this dish"}
                                        </Button>
                                        {data.hiddenReason ? (
                                            <Muted>
                                                Reason: {data.hiddenReason}
                                            </Muted>
                                        ) : null}
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Tags</h2>
                                        <div className="tag-list">
                                            {data.tags.length === 0 ? (
                                                <Muted>None</Muted>
                                            ) : (
                                                data.tags.map((tag) => (
                                                    <Pill key={tag.id}>
                                                        {tag.name} · {tag.type}
                                                    </Pill>
                                                ))
                                            )}
                                        </div>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Record</h2>
                                        <dl>
                                            <div className="kv">
                                                <dt>Added</dt>
                                                <dd>
                                                    {formatDateTime(
                                                        data.createdAt
                                                    )}
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>Updated</dt>
                                                <dd>
                                                    {formatDateTime(
                                                        data.updatedAt
                                                    )}
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>Origin</dt>
                                                <dd>{data.origin}</dd>
                                            </div>
                                            <div className="kv">
                                                <dt>Canonical id</dt>
                                                <dd className="mono">
                                                    {data.canonicalId ?? "—"}
                                                </dd>
                                            </div>
                                            <div className="kv">
                                                <dt>Id</dt>
                                                <dd className="mono">
                                                    {data.id}
                                                </dd>
                                            </div>
                                        </dl>
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            color="error"
                                            sx={{ mt: 4 }}
                                            disabled={Boolean(busy)}
                                            onClick={() => {
                                                setTypedName("");
                                                setConfirming(true);
                                            }}
                                        >
                                            Delete permanently
                                        </Button>
                                    </Paper>
                                </>
                            }
                        />

                        {dirty ? (
                            <Box className="save-bar">
                                <span className="state">
                                    {Object.keys(form).length} unsaved change
                                    {Object.keys(form).length === 1 ? "" : "s"}
                                </span>
                                <Button
                                    variant="text"
                                    onClick={() => setForm({})}
                                    disabled={Boolean(busy)}
                                >
                                    Discard
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={() => void save()}
                                    disabled={Boolean(busy)}
                                >
                                    {busy === "save"
                                        ? "Saving…"
                                        : "Save changes"}
                                </Button>
                            </Box>
                        ) : null}

                        {confirming ? (
                            <ConfirmDelete
                                what="dish"
                                name={data.name}
                                typed={typedName}
                                onTyped={setTypedName}
                                busy={busy === "delete"}
                                warning={
                                    referenceTotal(data) > 0 ? (
                                        <>
                                            It will also remove{" "}
                                            {referenceTotal(data)} reader
                                            reference
                                            {referenceTotal(data) === 1
                                                ? ""
                                                : "s"}{" "}
                                            — favourites, collections, shopping
                                            lists and menu courses. Hiding it
                                            instead keeps all of that.
                                        </>
                                    ) : undefined
                                }
                                onCancel={() => setConfirming(false)}
                                onConfirm={() => void remove()}
                            />
                        ) : null}
                    </>
                ) : null}
            </ResourceState>
        </>
    );
}

const referenceTotal = (recipe: AdminRecipeDetail): number =>
    recipe.references.favourites +
    recipe.references.collections +
    recipe.references.shoppingLists +
    recipe.references.menuCourses;

/**
 * The method.
 *
 * Steps are saved as a LIST, replacing what is there, because `step_number` is
 * a position — see the route's own note. So the editor owns the whole array and
 * reordering is moving an element, not renumbering rows.
 */
function StepsEditor({
    steps,
    dirty,
    busy,
    onChange,
    onSave,
    onReset,
}: {
    steps: AdminRecipeStep[];
    dirty: boolean;
    busy: boolean;
    onChange: (steps: AdminRecipeStep[]) => void;
    onSave: () => void;
    onReset: () => void;
}) {
    const update = (index: number, patch: Partial<AdminRecipeStep>) =>
        onChange(
            steps.map((step, position) =>
                position === index ? { ...step, ...patch } : step
            )
        );

    const move = (index: number, by: number) => {
        const next = [...steps];
        const target = index + by;

        if (target < 0 || target >= next.length) return;

        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    return (
        <Paper className="pad">
            <div className="section-head">
                <h2>Method ({steps.length})</h2>
                <div>
                    {dirty ? (
                        <Stack direction="row" spacing={2}>
                            <Button
                                size="small"
                                variant="text"
                                onClick={onReset}
                            >
                                Discard
                            </Button>
                            <Button
                                size="small"
                                variant="contained"
                                onClick={onSave}
                                disabled={busy}
                            >
                                {busy ? "Saving…" : "Save method"}
                            </Button>
                        </Stack>
                    ) : null}
                </div>
            </div>

            {steps.map((step, index) => (
                <div className="step-row" key={step.id || index}>
                    <div className="n">{index + 1}</div>
                    <div>
                        <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            value={step.instructionText}
                            onChange={(event) =>
                                update(index, {
                                    instructionText: event.target.value,
                                })
                            }
                            aria-label={`Step ${index + 1}`}
                        />
                        <Stack
                            direction="row"
                            spacing={2}
                            alignItems="center"
                            sx={{ mt: 2 }}
                        >
                            <TextField
                                type="number"
                                placeholder="Seconds"
                                value={step.durationSeconds ?? ""}
                                onChange={(event) =>
                                    update(index, {
                                        durationSeconds: event.target.value
                                            ? Number(event.target.value)
                                            : null,
                                    })
                                }
                                slotProps={{ htmlInput: { min: 0 } }}
                                aria-label={`Step ${index + 1} duration in seconds`}
                                sx={{ width: 120 }}
                            />
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move step ${index + 1} up`}
                            >
                                ↑
                            </Button>
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => move(index, 1)}
                                disabled={index === steps.length - 1}
                                aria-label={`Move step ${index + 1} down`}
                            >
                                ↓
                            </Button>
                            <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                onClick={() =>
                                    onChange(
                                        steps.filter((_, i) => i !== index)
                                    )
                                }
                            >
                                Remove
                            </Button>
                        </Stack>
                    </div>
                </div>
            ))}

            <Button
                size="small"
                variant="outlined"
                sx={{ mt: 3 }}
                onClick={() =>
                    onChange([
                        ...steps,
                        {
                            id: "",
                            stepNumber: steps.length + 1,
                            instructionText: "",
                            title: null,
                            durationSeconds: null,
                            temperatureC: null,
                            equipment: null,
                            tips: null,
                        },
                    ])
                }
            >
                Add a step
            </Button>
        </Paper>
    );
}

const LEVELS = [
    { value: "", label: "—" },
    { value: "easy", label: "Easy" },
    { value: "medium", label: "Medium" },
    { value: "hard", label: "Hard" },
] as const;
