import type { AdminSuggestionDetail } from "@fridgeezy/admin-contract";
import { Muted, Pill } from "@fridgeezy/design";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useToast } from "../components/toast";
import {
    ConfirmDelete,
    DetailLayout,
    DetailPage,
    Fact,
    Facts,
    PageHead,
    ResourceState,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime, formatMinutes } from "../lib/format";
import { useResource } from "../lib/use-resource";

/**
 * One dish idea.
 *
 * ## It is READ-ONLY, and that is not an omission
 *
 * A suggestion is what the generator wrote. Editing one would leave a row that
 * claims to be a model's output and is not, and every downstream decision —
 * whether to promote it, whether it deduped correctly — is made against that
 * claim. The two things the console may do are the two that were already on the
 * list: withhold it, or delete it.
 *
 * ## The ingredient list is where a bad suggestion is visibly bad
 *
 * The name and the gloss almost always read fine. It is "Tiramisu · chicken
 * thighs" that says the generator lost the plot, and that is the one thing the
 * table could not show.
 */
export function SuggestionDetailPage() {
    const { id = "" } = useParams();
    const navigate = useNavigate();
    const toast = useToast();

    const suggestion = useResource(
        () => api.get<AdminSuggestionDetail>(`/suggestions/${id}`),
        [id]
    );

    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [typed, setTyped] = useState("");

    const data = suggestion.data;

    const toggleHidden = async () => {
        if (!data) return;

        setBusy(true);

        try {
            await api.post(`/suggestions/${data.id}/hidden`, {
                hidden: !data.hiddenAt,
            });
            suggestion.reload();
            toast.show(
                "ok",
                data.hiddenAt ? "Visible again." : "Withheld from the feed."
            );
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!data) return;

        setBusy(true);

        try {
            await api.delete(`/suggestions/${data.id}`);
            navigate("/suggestions");
        } catch (cause) {
            setConfirming(false);
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <DetailPage backTo="/suggestions" backLabel="Suggestions">
            <ResourceState
                loading={suggestion.loading}
                error={suggestion.error}
            >
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
                                    {data.promotedRecipeId ? (
                                        <Link
                                            to={`/recipes/${data.promotedRecipeId}`}
                                        >
                                            <Pill tone="accent">Promoted</Pill>
                                        </Link>
                                    ) : null}
                                </>
                            }
                        />

                        <DetailLayout
                            main={
                                <>
                                    <Paper className="pad">
                                        <h2>What the generator wrote</h2>
                                        {data.description ? (
                                            <Typography
                                                variant="body2"
                                                sx={{ mb: 4 }}
                                            >
                                                {data.description}
                                            </Typography>
                                        ) : (
                                            <Muted>No gloss.</Muted>
                                        )}
                                        {data.nameEn &&
                                        data.nameEn !== data.name ? (
                                            <Muted>
                                                Also known as {data.nameEn}
                                            </Muted>
                                        ) : null}
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>
                                            Ingredients (
                                            {data.ingredients.length})
                                        </h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            Names only — a suggestion carries no
                                            amounts, which is the same fact as
                                            having no method. Both are decided
                                            when it is promoted.
                                        </Typography>
                                        {data.ingredients.length === 0 ? (
                                            <Muted>None recorded.</Muted>
                                        ) : (
                                            <div className="tag-list">
                                                {data.ingredients.map(
                                                    (ingredient) => (
                                                        <Pill
                                                            key={ingredient.id}
                                                        >
                                                            {ingredient.name}
                                                        </Pill>
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </Paper>
                                </>
                            }
                            aside={
                                <>
                                    <Paper className="pad">
                                        <h2>Record</h2>
                                        <Facts>
                                            <Fact label="Cuisine">
                                                {data.identityCuisine ?? "—"}
                                            </Fact>
                                            <Fact label="Level">
                                                {data.difficulty ?? "—"}
                                            </Fact>
                                            <Fact label="Time">
                                                {formatMinutes(
                                                    data.totalTimeMinutes
                                                )}
                                            </Fact>
                                            <Fact label="Written">
                                                {formatDateTime(data.createdAt)}
                                            </Fact>
                                            <Fact label="Canonical id">
                                                <span className="mono">
                                                    {data.canonicalId}
                                                </span>
                                            </Fact>
                                            <Fact label="Id">
                                                <span className="mono">
                                                    {data.id}
                                                </span>
                                            </Fact>
                                        </Facts>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Tags</h2>
                                        {data.tags.length === 0 ? (
                                            <Muted>None.</Muted>
                                        ) : (
                                            <div className="tag-list">
                                                {data.tags.map((tag) => (
                                                    <Link
                                                        key={tag.id}
                                                        to={`/tags/${tag.id}`}
                                                    >
                                                        <Pill tone="info">
                                                            {tag.name} ·{" "}
                                                            {tag.type}
                                                        </Pill>
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Visibility</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            {data.hiddenAt
                                                ? "Withheld from the feed and from search."
                                                : "Hiding withdraws this idea from the feed and from search. Nothing references an idea, so nothing else breaks."}
                                        </Typography>
                                        <Stack spacing={3}>
                                            <Button
                                                fullWidth
                                                variant="outlined"
                                                disabled={busy}
                                                onClick={() =>
                                                    void toggleHidden()
                                                }
                                            >
                                                {data.hiddenAt
                                                    ? "Make visible again"
                                                    : "Hide this idea"}
                                            </Button>
                                            <Button
                                                fullWidth
                                                variant="outlined"
                                                color="error"
                                                disabled={busy}
                                                onClick={() => {
                                                    setTyped("");
                                                    setConfirming(true);
                                                }}
                                            >
                                                Delete permanently
                                            </Button>
                                        </Stack>
                                    </Paper>
                                </>
                            }
                        />

                        {confirming ? (
                            <ConfirmDelete
                                what="idea"
                                name={data.name}
                                typed={typed}
                                onTyped={setTyped}
                                busy={busy}
                                warning={
                                    data.promotedRecipeId
                                        ? "The recipe promoted from it is not affected and stays in the catalogue."
                                        : "Nothing else references it — no reader can have saved an idea."
                                }
                                onCancel={() => setConfirming(false)}
                                onConfirm={() => void remove()}
                            />
                        ) : null}
                    </>
                ) : null}
            </ResourceState>
        </DetailPage>
    );
}
