import { ObjectToCamel, ObjectToSnake } from "ts-case-convert";

/**
 * Converts undefined to null, but only for fields that are already nullable
 * Fields that are just optional (T | undefined) remain unchanged
 * Fields that are nullable (T | null | undefined) have undefined replaced with null
 */
export type UndefinedAsNull<T> = {
    [K in keyof T]: null extends T[K] ? Exclude<T[K], undefined> | null : T[K];
};

export type FromPersistence<T extends object> = UndefinedAsNull<
    ObjectToCamel<T>
>;

export type ToPersistence<T extends object> = UndefinedAsNull<ObjectToSnake<T>>;

/**
 * Reverses FromPersistence transformation
 * When T is FromPersistence<U>, returns U
 * Otherwise returns ToPersistence<T>
 */
export type ReversePersistence<T extends object> =
    T extends FromPersistence<infer U> ? U : ToPersistence<T>;
