import { ValidationError, Result, success, failure } from "../../shared";

/**
 * Valid difficulty levels for recipe suggestions
 */
export type DifficultyLevel = "easy" | "medium" | "hard";

/**
 * Validate a difficulty level
 *
 * Ensures the value is one of: 'easy', 'medium', or 'hard'
 *
 * @param value The difficulty level string to validate
 * @returns Result containing the validated difficulty level or a ValidationError
 *
 * @example
 * ```typescript
 * const result = validateDifficulty('medium');
 * if (result.success) {
 *   console.log(result.value); // 'medium'
 * }
 * ```
 */
export function validateDifficulty(
    value: string
): Result<DifficultyLevel, ValidationError> {
    if (!isValidDifficulty(value)) {
        return failure(
            new ValidationError(
                `Invalid difficulty level: "${value}". Must be one of: easy, medium, hard`,
                "difficulty"
            )
        );
    }
    return success(value as DifficultyLevel);
}

/**
 * Type guard to check if a string is a valid difficulty level
 *
 * @param value The value to check
 * @returns true if value is a valid DifficultyLevel
 */
export function isValidDifficulty(value: string): value is DifficultyLevel {
    return ["easy", "medium", "hard"].includes(value);
}

/**
 * Check if difficulty level A is harder than difficulty level B
 *
 * @param a First difficulty level
 * @param b Second difficulty level
 * @returns true if a is harder than b
 *
 * @example
 * ```typescript
 * difficultyIsHarderThan('hard', 'easy'); // true
 * difficultyIsHarderThan('medium', 'hard'); // false
 * ```
 */
export function difficultyIsHarderThan(
    a: DifficultyLevel,
    b: DifficultyLevel
): boolean {
    const order: Record<DifficultyLevel, number> = {
        easy: 1,
        medium: 2,
        hard: 3,
    };
    return order[a] > order[b];
}

/**
 * Check if difficulty level A is easier than difficulty level B
 *
 * @param a First difficulty level
 * @param b Second difficulty level
 * @returns true if a is easier than b
 */
export function difficultyIsEasierThan(
    a: DifficultyLevel,
    b: DifficultyLevel
): boolean {
    const order: Record<DifficultyLevel, number> = {
        easy: 1,
        medium: 2,
        hard: 3,
    };
    return order[a] < order[b];
}

/**
 * Get numeric representation of difficulty (1=easy, 2=medium, 3=hard)
 *
 * @param difficulty The difficulty level
 * @returns Numeric representation
 */
export function difficultyToNumeric(difficulty: DifficultyLevel): number {
    const order: Record<DifficultyLevel, number> = {
        easy: 1,
        medium: 2,
        hard: 3,
    };
    return order[difficulty];
}

/**
 * Check if two difficulty levels are equal
 *
 * @param a First difficulty level
 * @param b Second difficulty level
 * @returns true if equal
 */
export function difficultiesEqual(
    a: DifficultyLevel,
    b: DifficultyLevel
): boolean {
    return a === b;
}
