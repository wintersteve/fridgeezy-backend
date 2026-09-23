import { z } from "zod/v4";

import { PageRequestSchema, SortDirectionSchema } from "./common";

export const AdminUserFilterSchema = PageRequestSchema.extend({
    query: z.string().trim().max(200).optional(),
    /** Entitlement state, derived the way the API derives it — never stored. */
    subscription: z.enum(["any", "active", "none"]).default("any"),
    sort: z.enum(["createdAt", "aiCalls"]).default("createdAt"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminUserFilter = z.infer<typeof AdminUserFilterSchema>;

export interface AdminUserRow {
    profileId: string;
    userId: string;
    email: string | null;
    displayName: string | null;
    isAdmin: boolean;
    onboardingCompleted: boolean;
    createdAt: string;
    lastSignInAt: string | null;
    entitlement: {
        active: boolean;
        entitlementId: string | null;
        productId: string | null;
        store: string | null;
        expiresAt: string | null;
        revokedAt: string | null;
        verifiedAt: string | null;
    } | null;
    /** AI calls in the last 30 days, by bucket. */
    usage: Record<string, number>;
}

/**
 * The only thing the console may write about a person.
 *
 * Not their preferences, not their diet, not their saved recipes: those are
 * theirs, this tool has no business editing them, and a support question that
 * needs one is a question to ask them. The admin flag is the exception because
 * it is the tool's OWN access list, and there is otherwise no way to grant it
 * without a psql session.
 */
export const AdminUserUpdateSchema = z.object({
    isAdmin: z.boolean(),
});

export type AdminUserUpdate = z.infer<typeof AdminUserUpdateSchema>;

/**
 * One account, and nothing the console has no business showing.
 *
 * The row's rule holds harder on a page: what a person cooks, saves and plans
 * is THEIRS. So this adds only what the tool itself is responsible for — the
 * access flag, what the server believes about their subscription, and what
 * they have spent — plus the counts that answer a support question without
 * reading anybody's dinner.
 *
 * **The counts are counts, never contents.** "41 saved recipes" answers "is
 * this account actually used"; the list of them answers a question nobody
 * asked and the reader did not consent to.
 */
export interface AdminUserDetail extends AdminUserRow {
    /** AI calls by bucket over the same 30 days, and the total. */
    usageTotal: number;
    library: {
        favourites: number;
        collections: number;
        shoppingLists: number;
        menus: number;
        importedRecipes: number;
    };
}
