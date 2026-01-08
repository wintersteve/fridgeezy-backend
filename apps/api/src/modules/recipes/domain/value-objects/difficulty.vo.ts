/**
 * Difficulty value object.
 * Encapsulates difficulty levels and escalation logic.
 */

export type Difficulty = "easy" | "medium" | "hard";

/**
 * Maps current difficulty to next difficulty level.
 * Easy → Medium → Hard → Hard (max level)
 */
export const DIFFICULTY_MAP = {
    easy: "medium",
    medium: "hard",
    hard: "hard", // Already at max, but will enhance techniques
} as const;

/**
 * Difficulty value object with business logic.
 */
export class DifficultyValue {
    /**
     * Escalates difficulty to the next level.
     * @param current - Current difficulty level
     * @returns Next difficulty level
     */
    static escalate(current: Difficulty): Difficulty {
        return DIFFICULTY_MAP[current];
    }

    /**
     * Checks if difficulty can be escalated further.
     * @param current - Current difficulty level
     * @returns true if can escalate (not at max), false otherwise
     */
    static canEscalate(current: Difficulty): boolean {
        return current !== "hard";
    }

    /**
     * Validates if a string is a valid difficulty level.
     * @param value - String to validate
     * @returns true if valid difficulty, false otherwise
     */
    static isValid(value: string): value is Difficulty {
        return ["easy", "medium", "hard"].includes(value);
    }
}
