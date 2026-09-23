import {
    COMPONENT_KINDS,
    type AdminCategory,
    type AdminIngredientDetail,
    type AdminIngredientUpdate,
} from "@fridgeezy/admin-contract";
import { Muted, Pill, TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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
 * The expiry half of the shelf-life constraint, as a choice rather than a
 * toggle.
 *
 * A switch said only "Expires" and left its off state unlabelled, which on the
 * one field pair the database refuses to accept in the wrong combination is the
 * worst place for silence. Both answers are written out here.
 */
const KEEPS = [
    { value: "forever", label: "Keeps indefinitely" },
    { value: "expires", label: "Expires" },
] as const;

const KINDS = [
    { value: "", label: "Unclassified" },
    ...COMPONENT_KINDS.map((kind) => ({ value: kind, label: kind })),
];

/**
 * One ingredient.
 *
 * ## The dishes are the reason this is a page
 *
 * Four editable fields do not need a route of their own — that is what the
 * inline editor this replaces was for, and its note was right about that much.
 * What it could not show is `usedIn`, and that list is what the reader is
 * actually asking about: an ingredient with 120 dishes is the row everything
 * joins on, and one with none beside a near-identical name is the duplicate to
 * merge away.
 */
export function IngredientDetailPage() {
    const { id = "" } = useParams();
    const toast = useToast();

    const ingredient = useResource(
        () => api.get<AdminIngredientDetail>(`/ingredients/${id}`),
        [id]
    );
    const categories = useResource(
        () => api.get<AdminCategory[]>("/categories"),
        []
    );

    const [form, setForm] = useState<AdminIngredientUpdate>({});
    const [busy, setBusy] = useState(false);

    useEffect(() => setForm({}), [id]);

    const data = ingredient.data;

    // The form holds only what has been TOUCHED; everything else reads through
    // to the loaded row. That is what makes "3 unsaved changes" a real set
    // rather than a diff of two near-identical objects — the recipe page's own
    // rule, applied here.
    const value = <K extends keyof AdminIngredientUpdate>(
        key: K,
        fallback: AdminIngredientUpdate[K]
    ): AdminIngredientUpdate[K] => (key in form ? form[key] : fallback);

    const set = <K extends keyof AdminIngredientUpdate>(
        key: K,
        next: AdminIngredientUpdate[K]
    ) => setForm((current) => ({ ...current, [key]: next }));

    // Read once, because three controls and the save guard all ask the same
    // two questions and a disagreement between them is an unsaveable form that
    // says nothing about why.
    // `expires_by_default` is nullable in the row and NOT in the update schema,
    // which is the constraint speaking: a row that has never been asked reads
    // null, and answering the question at all means answering it with a boolean.
    // Null is taken as "does not expire", the state the constraint pairs with a
    // null shelf life.
    const expires = data
        ? (value("expiresByDefault", data.expiresByDefault ?? false) ?? false)
        : false;
    const shelfLife = data
        ? (value("defaultShelfLifeDays", data.defaultShelfLifeDays) ?? null)
        : null;
    const shelfLifeInvalid = expires && !(shelfLife && shelfLife > 0);

    const save = async () => {
        if (!data) return;

        setBusy(true);

        try {
            await api.patch(`/ingredients/${data.id}`, form);
            setForm({});
            ingredient.reload();
            toast.show("ok", "Saved.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <DetailPage backTo="/ingredients" backLabel="Ingredients">
            <ResourceState
                loading={ingredient.loading}
                error={ingredient.error}
            >
                {data ? (
                    <>
                        <PageHead
                            title={data.name}
                            lede={
                                data.aliases.length
                                    ? `also: ${data.aliases.join(", ")}`
                                    : undefined
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
                                                helperText="The display name. What it JOINS on is the canonical id, which is derived and not editable — changing that is a merge."
                                            />
                                            <Stack
                                                direction="row"
                                                spacing={4}
                                                flexWrap="wrap"
                                                useFlexGap
                                            >
                                                <TextField
                                                    select
                                                    label="Category"
                                                    value={
                                                        value(
                                                            "categoryId",
                                                            data.categoryId
                                                        ) ?? ""
                                                    }
                                                    onChange={(event) =>
                                                        set(
                                                            "categoryId",
                                                            event.target
                                                                .value || null
                                                        )
                                                    }
                                                    sx={{ minWidth: 200 }}
                                                >
                                                    <MenuItem value="">
                                                        —
                                                    </MenuItem>
                                                    {(
                                                        categories.data ?? []
                                                    ).map((category) => (
                                                        <MenuItem
                                                            key={category.id}
                                                            value={category.id}
                                                        >
                                                            {category.name}
                                                        </MenuItem>
                                                    ))}
                                                </TextField>
                                                {/* The two fields are ONE decision,
                                                enforced by a check constraint:
                                                `expires_by_default = false`
                                                requires a NULL shelf life, and
                                                `true` requires a positive one.
                                                Editing them separately is a 500
                                                from the database — which is what
                                                the inline editor this replaces
                                                did, since it drew the days field
                                                and no control for it at all. */}
                                                <TextField
                                                    select
                                                    label="Keeps"
                                                    value={
                                                        expires
                                                            ? "expires"
                                                            : "forever"
                                                    }
                                                    onChange={(event) => {
                                                        const on =
                                                            event.target
                                                                .value ===
                                                            "expires";

                                                        setForm((current) => ({
                                                            ...current,
                                                            expiresByDefault:
                                                                on,
                                                            // Cleared on the way off,
                                                            // set to the fallback on
                                                            // the way on — an answer
                                                            // that leaves the row
                                                            // violating the constraint
                                                            // is an answer that cannot
                                                            // be saved.
                                                            defaultShelfLifeDays:
                                                                on
                                                                    ? (data.defaultShelfLifeDays ??
                                                                      30)
                                                                    : null,
                                                        }));
                                                    }}
                                                    sx={{ minWidth: 190 }}
                                                >
                                                    {KEEPS.map((option) => (
                                                        <MenuItem
                                                            key={option.value}
                                                            value={option.value}
                                                        >
                                                            {option.label}
                                                        </MenuItem>
                                                    ))}
                                                </TextField>
                                                <TextField
                                                    label="Shelf life (days)"
                                                    type="number"
                                                    slotProps={{
                                                        htmlInput: { min: 1 },
                                                    }}
                                                    disabled={!expires}
                                                    error={
                                                        expires &&
                                                        !(
                                                            shelfLife &&
                                                            shelfLife > 0
                                                        )
                                                    }
                                                    value={shelfLife ?? ""}
                                                    onChange={(event) =>
                                                        set(
                                                            "defaultShelfLifeDays",
                                                            event.target.value
                                                                ? Number(
                                                                      event
                                                                          .target
                                                                          .value
                                                                  )
                                                                : null
                                                        )
                                                    }
                                                    helperText={
                                                        expires
                                                            ? "What the pantry decays this on."
                                                            : "Keeps indefinitely."
                                                    }
                                                    sx={{ width: 190 }}
                                                />
                                            </Stack>
                                        </Stack>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Make or buy</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            {`A "dish" grows a "make it yourself" line on every recipe
                                        that uses it. The answer that has to be right is BOUGHT —
                                        missing a béchamel costs a link nobody notices, offering
                                        to make soy sauce teaches the reader to ignore the marker
                                        everywhere it is correct.`}
                                        </Typography>
                                        <Stack
                                            direction="row"
                                            spacing={4}
                                            flexWrap="wrap"
                                            useFlexGap
                                        >
                                            <TextField
                                                select
                                                label="Component kind"
                                                value={
                                                    value(
                                                        "componentKind",
                                                        data.componentKind
                                                    ) ?? ""
                                                }
                                                onChange={(event) =>
                                                    set(
                                                        "componentKind",
                                                        (event.target.value ||
                                                            null) as AdminIngredientUpdate["componentKind"]
                                                    )
                                                }
                                                sx={{ minWidth: 180 }}
                                            >
                                                {KINDS.map((kind) => (
                                                    <MenuItem
                                                        key={kind.value}
                                                        value={kind.value}
                                                    >
                                                        {kind.label}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <TextField
                                                label="Dish to open"
                                                value={
                                                    value(
                                                        "componentDish",
                                                        data.componentDish
                                                    ) ?? ""
                                                }
                                                onChange={(event) =>
                                                    set(
                                                        "componentDish",
                                                        event.target.value ||
                                                            null
                                                    )
                                                }
                                                placeholder="Béchamel"
                                                disabled={
                                                    (value(
                                                        "componentKind",
                                                        data.componentKind
                                                    ) ?? "") !== "dish"
                                                }
                                                helperText="Not always the ingredient's own name."
                                                sx={{ flex: 1, minWidth: 220 }}
                                            />
                                        </Stack>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Used in ({data.usedInTotal})</h2>
                                        {data.usedIn.length === 0 ? (
                                            <Muted>
                                                No recipe holds this ingredient.
                                                Either it is new, or it is a
                                                duplicate of a row that does.
                                            </Muted>
                                        ) : (
                                            <Stack spacing={2}>
                                                {data.usedIn.map((dish) => (
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
                                                {data.usedInTotal >
                                                data.usedIn.length ? (
                                                    <Muted>
                                                        …and{" "}
                                                        {data.usedInTotal -
                                                            data.usedIn
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
                                            <Fact label="Used in">
                                                {data.useCount}
                                            </Fact>
                                            <Fact label="Canonical id">
                                                <span className="mono">
                                                    {data.canonicalId ?? "—"}
                                                </span>
                                            </Fact>
                                            <Fact label="Category">
                                                {data.categoryName ?? "—"}
                                            </Fact>
                                            <Fact label="Vector">
                                                {data.hasEmbedding
                                                    ? "yes"
                                                    : "missing"}
                                            </Fact>
                                            <Fact label="Id">
                                                <span className="mono">
                                                    {data.id}
                                                </span>
                                            </Fact>
                                        </Facts>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Dietary properties</h2>
                                        {/* Read-only, and that is the point. These are
                                        derived by a classifier and every dietary
                                        filter in the app is assembled from them in
                                        SQL — a hand-edited one would make a dish
                                        claim a diet the rules do not grant it. */}
                                        {data.dietaryProperties === null ? (
                                            <Muted>
                                                Unclassified — every recipe
                                                using this is excluded from
                                                every dietary filter until it
                                                is.
                                            </Muted>
                                        ) : data.dietaryProperties.length ===
                                          0 ? (
                                            <Muted>Carries none of them.</Muted>
                                        ) : (
                                            <div className="tag-list">
                                                {data.dietaryProperties.map(
                                                    (property) => (
                                                        <Pill key={property}>
                                                            {property}
                                                        </Pill>
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </Paper>

                                    {data.shelfLife ||
                                    data.storageTips ||
                                    data.description ? (
                                        <Paper className="pad">
                                            <h2>Catalogue copy</h2>
                                            {data.description ? (
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        mb: 3,
                                                        color: TOKENS.inkSoft,
                                                    }}
                                                >
                                                    {data.description}
                                                </Typography>
                                            ) : null}
                                            <Facts>
                                                {data.shelfLife ? (
                                                    <Fact label="Shelf life">
                                                        {data.shelfLife}
                                                    </Fact>
                                                ) : null}
                                                {data.storageTips ? (
                                                    <Fact label="Storage">
                                                        {data.storageTips}
                                                    </Fact>
                                                ) : null}
                                            </Facts>
                                        </Paper>
                                    ) : null}
                                </>
                            }
                        />

                        <SaveBar
                            count={Object.keys(form).length}
                            busy={busy || shelfLifeInvalid}
                            blocked={
                                shelfLifeInvalid
                                    ? "An expiring ingredient needs a shelf life of at least a day"
                                    : undefined
                            }
                            onDiscard={() => setForm({})}
                            onSave={() => void save()}
                        />
                    </>
                ) : null}
            </ResourceState>
        </DetailPage>
    );
}
