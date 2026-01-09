/**
 * @fridgeezy/supabase
 *
 * Infrastructure layer providing Supabase repository implementations.
 * Platform-agnostic - works in both Node.js and React Native.
 *
 * This library only contains infrastructure code. For domain types and
 * application services, import from @fridgeezy/domain and @fridgeezy/application.
 */

// Supabase client exports
export * from "./lib/modules/client";
export * from "./lib/modules/client/database.types";

// Repository implementations
export * from "./lib/modules/infrastructure";
