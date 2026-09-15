import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileChatConversation = Tables<"profile_chat_conversations">;

export type ProfileChatConversationInsertPayload = TablesInsert<"profile_chat_conversations">;

export type ProfileChatConversationUpdatePayload = TablesUpdate<"profile_chat_conversations">;
