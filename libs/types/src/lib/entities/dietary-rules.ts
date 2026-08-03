import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type DietaryRule = Tables<"dietary_rules">;

export type DietaryRuleInsertPayload = TablesInsert<"dietary_rules">;

export type DietaryRuleUpdatePayload = TablesUpdate<"dietary_rules">;
