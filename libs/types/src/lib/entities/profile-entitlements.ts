import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileEntitlement = Tables<"profile_entitlements">;

export type ProfileEntitlementInsertPayload = TablesInsert<"profile_entitlements">;

export type ProfileEntitlementUpdatePayload = TablesUpdate<"profile_entitlements">;
