import { objectToSnake } from "ts-case-convert";

import { FromPersistence, ToPersistence } from "../../types";

export function toPersistence<T extends object>(input: T): ToPersistence<T>;

export function toPersistence<
    TDb extends object,
    TInput extends FromPersistence<TDb> = FromPersistence<TDb>,
>(input: TInput): TDb;

export function toPersistence<T extends object>(
    input: T
): ToPersistence<T> | T {
    return objectToSnake(input) as ToPersistence<T> | T;
}
