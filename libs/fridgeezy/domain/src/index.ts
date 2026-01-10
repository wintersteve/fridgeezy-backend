/**
 * @fridgeezy/domain
 *
 * Business logic layer containing domain types, validation, behaviors,
 * and domain events. Platform-agnostic - works in Node.js and React Native.
 */

// Domain Types (re-exports from @fridgeezy/types with singular naming)
export * from './types';

// Validation Functions
export * from './validation';

// Business Behaviors
export * from './behaviors';

// Events
export * from './events';

// Repository Interfaces
export * from './interfaces';

// Shared (Result, errors, common types)
export * from './shared';
