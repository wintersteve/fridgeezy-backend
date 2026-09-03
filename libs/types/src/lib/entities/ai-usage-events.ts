import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type AiUsageEvent = Tables<"ai_usage_events">;

export type AiUsageEventInsertPayload = TablesInsert<"ai_usage_events">;

export type AiUsageEventUpdatePayload = TablesUpdate<"ai_usage_events">;
