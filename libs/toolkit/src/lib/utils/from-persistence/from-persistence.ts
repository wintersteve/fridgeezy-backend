import { objectToCamel } from "ts-case-convert";

import { FromPersistence, ToPersistence } from "../../types";

// General fromPersistence function (accepts null)
export function fromPersistence<T extends object>(
    input: T | null
): FromPersistence<T> | null;

// Specialized version that takes the database type as explicit generic
export function fromPersistence<
    TDb extends object,
    TInput extends ToPersistence<TDb> = ToPersistence<TDb>,
>(input: TInput | null): FromPersistence<TDb> | null;

// Implementation
export function fromPersistence<T extends object>(
    input: T | null
): FromPersistence<T> | T | null {
    if (input === null) return null;
    return objectToCamel(input) as FromPersistence<T> | T;
}
