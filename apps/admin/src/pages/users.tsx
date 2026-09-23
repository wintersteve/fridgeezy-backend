import type { AdminUserRow, Page } from "@fridgeezy/admin-contract";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
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
import { formatDate } from "../lib/format";
import { useListParams } from "../lib/use-list-params";
import { useDebounced, useResource } from "../lib/use-resource";
import { TOKENS } from "../theme";

const PAGE_SIZE = 50;

/**
 * Who has an account, what they pay for, what they use.
 *
 * ## The only thing editable here is the ADMIN flag
 *
 * Not their diet, not their skill level, not their saved recipes. Those are
 * theirs, this tool has no business editing them, and a support question that
 * needs one is a question to ask them. The flag is the exception because it is
 * this console's own access list, and there is otherwise no way to grant it
 * without a psql session against production.
 *
 * ## The subscription is what the SERVER believes, not what RevenueCat says
 *
 * `profile_entitlements` is written by the RevenueCat webhook and corrected by
 * reconciliation. Showing the row as stored is the whole point: when somebody
 * reports that the app thinks they are not subscribed, this is the screen that
 * says whether the server agrees. A page that re-verified against RevenueCat on
 * load would hide the exact discrepancy it exists to show — and would make one
 * API call per row.
 */
export function UsersPage() {
    const { get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "createdAt",
        dir: "desc",
    });
    const toast = useToast();
    const [busy, setBusy] = useState<string>();

    const query = get("query");
    const subscription = get("subscription", "any");

    const debouncedQuery = useDebounced(query);

    const users = useResource(
        () =>
            api.get<Page<AdminUserRow>>(
                `/users${queryString({
                    query: debouncedQuery,
                    subscription,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [debouncedQuery, subscription, sort, dir, offset]
    );

    const setAdmin = async (row: AdminUserRow, isAdmin: boolean) => {
        setBusy(row.profileId);

        try {
            await api.patch(`/users/${row.profileId}`, { isAdmin });
            users.reload();
            toast.show(
                "ok",
                `${row.email ?? row.displayName ?? "Account"} ${isAdmin ? "is now an admin" : "is no longer an admin"}.`
            );
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    const totalUsage = (row: AdminUserRow) =>
        Object.values(row.usage).reduce((sum, value) => sum + value, 0);

    return (
        <>
            <Typography variant="h1">Users</Typography>
            <Typography variant="body2" className="page-lede">
                Accounts, what the server believes about their subscription, and their AI
                usage over the last 30 days. The admin flag is the only thing you can change
                here.
            </Typography>

            <FilterBar count={users.data ? `${users.data.total} accounts` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search users"
                    placeholder="Search name or email…"
                />
                <FilterSelect
                    value={subscription}
                    onChange={(value) => setParam("subscription", value)}
                    label="Subscription"
                    width={190}
                    options={SUBSCRIPTION}
                />
            </FilterBar>

            <Paper>
                <ResourceState
                    loading={users.loading}
                    fetching={users.fetching}
                    error={users.error}
                    empty={users.data?.rows.length === 0}
                    emptyTitle="No accounts match"
                >
                    <DataTable
                        head={
                            <>
                                <TableCell>Account</TableCell>
                                <TableCell>Subscription</TableCell>
                                <SortTh
                                    column="aiCalls"
                                    label="AI calls (30d)"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    align="right"
                                    onSort={setSort}
                                />
                                <SortTh
                                    column="createdAt"
                                    label="Joined"
                                    sort={sort}
                                    dir={dir}
                                    first="desc"
                                    onSort={setSort}
                                />
                                {/* Last seen comes from `auth.users` through
                                    the directory RPC, which is read for the
                                    page rather than the table — so there is
                                    nothing to order the whole directory by. */}
                                <TableCell>Last seen</TableCell>
                                <TableCell align="right">Admin</TableCell>
                            </>
                        }
                    >
                        {users.data?.rows.map((row) => (
                            <TableRow key={row.profileId}>
                                <TableCell>
                                    <div className="cell-title">
                                        {row.email ?? row.displayName ?? "—"}
                                    </div>
                                    <Typography
                                        variant="caption"
                                        component="div"
                                        sx={{ color: TOKENS.inkMuted }}
                                    >
                                        {row.displayName && row.email
                                            ? row.displayName
                                            : row.onboardingCompleted
                                              ? "Onboarded"
                                              : "Onboarding not finished"}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    {row.entitlement?.active ? (
                                        <>
                                            <Pill tone="live">Active</Pill>
                                            <Typography
                                                variant="caption"
                                                component="div"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                {row.entitlement.store ?? "—"} ·{" "}
                                                {row.entitlement.expiresAt
                                                    ? `until ${formatDate(row.entitlement.expiresAt)}`
                                                    : "no expiry"}
                                            </Typography>
                                        </>
                                    ) : row.entitlement ? (
                                        <>
                                            <Pill tone="hidden">Lapsed</Pill>
                                            <Typography
                                                variant="caption"
                                                component="div"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                {row.entitlement.revokedAt
                                                    ? `revoked ${formatDate(row.entitlement.revokedAt)}`
                                                    : `expired ${formatDate(row.entitlement.expiresAt)}`}
                                            </Typography>
                                        </>
                                    ) : (
                                        <Typography variant="caption" sx={{ color: TOKENS.inkMuted }}>
                                            None
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell
                                    align="right"
                                    sx={totalUsage(row) === 0 ? { color: TOKENS.inkMuted } : undefined}
                                >
                                    {totalUsage(row)}
                                    {totalUsage(row) === 0 ? null : (
                                        <Typography
                                            variant="caption"
                                            component="div"
                                            sx={{ color: TOKENS.inkMuted }}
                                        >
                                            {Object.entries(row.usage)
                                                .map(([bucket, count]) => `${bucket} ${count}`)
                                                .join(" · ")}
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell sx={{ color: TOKENS.inkMuted, whiteSpace: "nowrap" }}>
                                    {formatDate(row.createdAt)}
                                </TableCell>
                                <TableCell sx={{ color: TOKENS.inkMuted, whiteSpace: "nowrap" }}>
                                    {formatDate(row.lastSignInAt)}
                                </TableCell>
                                <TableCell align="right">
                                    <Stack
                                        direction="row"
                                        spacing={2}
                                        alignItems="center"
                                        justifyContent="flex-end"
                                    >
                                        {row.isAdmin ? <Pill tone="accent">Admin</Pill> : null}
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            disabled={busy === row.profileId}
                                            onClick={() => void setAdmin(row, !row.isAdmin)}
                                        >
                                            {row.isAdmin ? "Revoke" : "Make admin"}
                                        </Button>
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </DataTable>
                    <Pager
                        total={users.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>
        </>
    );
}

const SUBSCRIPTION = [
    { value: "any", label: "Any subscription" },
    { value: "active", label: "Subscribed" },
    { value: "none", label: "Not subscribed" },
] as const;
