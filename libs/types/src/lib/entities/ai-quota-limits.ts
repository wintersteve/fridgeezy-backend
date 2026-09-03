import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type AiQuotaLimit = Tables<"ai_quota_limits">;

export type AiQuotaLimitInsertPayload = TablesInsert<"ai_quota_limits">;

export type AiQuotaLimitUpdatePayload = TablesUpdate<"ai_quota_limits">;
