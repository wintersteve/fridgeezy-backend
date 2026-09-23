import type { AdminUserDetail } from "@fridgeezy/admin-contract";
import { Muted, Pill } from "@fridgeezy/design";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { useToast } from "../components/toast";
import {
    DetailLayout,
    DetailPage,
    Fact,
    Facts,
    PageHead,
    ResourceState,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useResource } from "../lib/use-resource";

/**
 * One account.
 *
 * ## Counts, never contents
 *
 * The list's rule holds harder on a page with room to break it: what a person
 * cooks, saves and plans is THEIRS. "41 saved recipes" answers whether the
 * account is actually used — which is a real support question — and the list of
 * those recipes answers a question nobody asked and the reader never consented
 * to. Every figure below is a count taken with `head: true`, so the rows are
 * never fetched and there is nothing here to leak by accident.
 *
 * ## The admin flag is the only writable thing, and it is the tool's own
 *
 * Not their diet, not their skill level. The flag is the exception because it
 * is this console's access list, and there is otherwise no way to grant it
 * without a psql session.
 */
export function UserDetailPage() {
    const { profileId = "" } = useParams();
    const toast = useToast();

    const user = useResource(
        () => api.get<AdminUserDetail>(`/users/${profileId}`),
        [profileId]
    );

    const [busy, setBusy] = useState(false);
    const data = user.data;

    const setAdmin = async (isAdmin: boolean) => {
        if (!data) return;

        setBusy(true);

        try {
            await api.patch(`/users/${data.profileId}`, { isAdmin });
            user.reload();
            toast.show("ok", isAdmin ? "Now an admin." : "No longer an admin.");
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <DetailPage backTo="/users" backLabel="Users">
            <ResourceState loading={user.loading} error={user.error}>
                {data ? (
                    <>
                        <PageHead
                            title={data.email ?? data.displayName ?? "Account"}
                            lede={
                                <>
                                    {data.isAdmin ? (
                                        <Pill tone="accent">Admin</Pill>
                                    ) : null}
                                    {data.entitlement?.active ? (
                                        <Pill tone="live">Subscribed</Pill>
                                    ) : data.entitlement ? (
                                        <Pill tone="hidden">Lapsed</Pill>
                                    ) : (
                                        <Pill>No subscription</Pill>
                                    )}
                                    {data.onboardingCompleted ? null : (
                                        <Pill tone="rose">
                                            Onboarding not finished
                                        </Pill>
                                    )}
                                </>
                            }
                        />

                        <DetailLayout
                            main={
                                <>
                                    <Paper className="pad">
                                        <h2>Subscription</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            What the SERVER believes, which is
                                            the thing worth looking at when
                                            somebody reports it is wrong. This
                                            page never asks RevenueCat —
                                            reconciliation is triggered by the
                                            device, and having a console
                                            re-verify on every open would check
                                            two hundred subscriptions to draw
                                            one card.
                                        </Typography>
                                        {data.entitlement ? (
                                            <Facts>
                                                <Fact label="State">
                                                    {data.entitlement.active
                                                        ? "Active"
                                                        : "Lapsed"}
                                                </Fact>
                                                <Fact label="Entitlement">
                                                    {data.entitlement
                                                        .entitlementId ?? "—"}
                                                </Fact>
                                                <Fact label="Product">
                                                    {data.entitlement
                                                        .productId ?? "—"}
                                                </Fact>
                                                <Fact label="Store">
                                                    {data.entitlement.store ??
                                                        "—"}
                                                </Fact>
                                                <Fact label="Expires">
                                                    {formatDateTime(
                                                        data.entitlement
                                                            .expiresAt
                                                    )}
                                                </Fact>
                                                <Fact label="Revoked">
                                                    {formatDateTime(
                                                        data.entitlement
                                                            .revokedAt
                                                    )}
                                                </Fact>
                                                <Fact label="Last verified">
                                                    {formatDateTime(
                                                        data.entitlement
                                                            .verifiedAt
                                                    )}
                                                </Fact>
                                            </Facts>
                                        ) : (
                                            <Muted>
                                                No entitlement row. Either they
                                                have never subscribed, or no
                                                webhook has ever reached this
                                                database for them.
                                            </Muted>
                                        )}
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>AI calls, last 30 days</h2>
                                        {data.usageTotal === 0 ? (
                                            <Muted>
                                                Nothing in the last month.
                                            </Muted>
                                        ) : (
                                            <Facts>
                                                {Object.entries(data.usage)
                                                    .sort((a, b) => b[1] - a[1])
                                                    .map(([bucket, count]) => (
                                                        <Fact
                                                            key={bucket}
                                                            label={bucket}
                                                        >
                                                            {count}
                                                        </Fact>
                                                    ))}
                                                <Fact label="Total">
                                                    {data.usageTotal}
                                                </Fact>
                                            </Facts>
                                        )}
                                    </Paper>
                                </>
                            }
                            aside={
                                <>
                                    <Paper className="pad">
                                        <h2>Account</h2>
                                        <Facts>
                                            <Fact label="Email">
                                                {data.email ?? "—"}
                                            </Fact>
                                            <Fact label="Name">
                                                {data.displayName ?? "—"}
                                            </Fact>
                                            <Fact label="Joined">
                                                {formatDateTime(data.createdAt)}
                                            </Fact>
                                            <Fact label="Last seen">
                                                {formatDateTime(
                                                    data.lastSignInAt
                                                )}
                                            </Fact>
                                            <Fact label="Profile id">
                                                <span className="mono">
                                                    {data.profileId}
                                                </span>
                                            </Fact>
                                        </Facts>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Library</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            How much is here, never what is in
                                            it.
                                        </Typography>
                                        <Facts>
                                            <Fact label="Favourites">
                                                {data.library.favourites}
                                            </Fact>
                                            <Fact label="Collections">
                                                {data.library.collections}
                                            </Fact>
                                            <Fact label="Shopping lists">
                                                {data.library.shoppingLists}
                                            </Fact>
                                            <Fact label="Menus">
                                                {data.library.menus}
                                            </Fact>
                                            <Fact label="Imported recipes">
                                                {data.library.importedRecipes}
                                            </Fact>
                                        </Facts>
                                    </Paper>

                                    <Paper className="pad">
                                        <h2>Console access</h2>
                                        <Typography
                                            variant="body2"
                                            className="card-note"
                                        >
                                            {data.isAdmin
                                                ? "This account can read and change the whole catalogue."
                                                : "Granting this gives full read and write over the catalogue and every account."}
                                        </Typography>
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            color={
                                                data.isAdmin
                                                    ? "error"
                                                    : "primary"
                                            }
                                            disabled={busy}
                                            onClick={() =>
                                                void setAdmin(!data.isAdmin)
                                            }
                                        >
                                            {data.isAdmin
                                                ? "Revoke admin"
                                                : "Make admin"}
                                        </Button>
                                    </Paper>
                                </>
                            }
                        />
                    </>
                ) : null}
            </ResourceState>
        </DetailPage>
    );
}
