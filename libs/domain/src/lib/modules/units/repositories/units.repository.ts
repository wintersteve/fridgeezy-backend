import { Unit } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

export interface UnitVectorMatch {
    unit: Unit;
    similarity: number;
}

export interface IUnitsRepository {
    /**
     * Find a unit by its canonical_id (normalized name)
     * @param canonicalId Normalized unit identifier
     * @returns Unit if found, null otherwise
     */
    findByCanonicalId(
        canonicalId: string
    ): Promise<Result<Unit | null, DomainError>>;

    /**
     * Find a unit by its abbreviation (exact match)
     * @param abbreviation Unit abbreviation (e.g., "g", "ml", "tsp")
     * @returns Unit if found, null otherwise
     */
    findByAbbreviation(
        abbreviation: string
    ): Promise<Result<Unit | null, DomainError>>;

    /**
     * Find the best matching unit using vector similarity search.
     * Always returns a match (no threshold) - the closest unit is returned.
     * @param embedding Vector embedding (1536 dimensions)
     * @returns Best matching unit with similarity score
     */
    findBestMatch(
        embedding: number[]
    ): Promise<Result<UnitVectorMatch, DomainError>>;

    /**
     * Resolve a unit string using the lookup chain:
     * 1. canonical_id (normalized unit string matches unit name)
     * 2. abbreviation (exact match)
     * 3. vector search (semantic similarity, optional)
     *
     * @param unitString The unit string to resolve (e.g., "leaf", "g", "tablespoons")
     * @param embedding Optional vector embedding for semantic fallback
     * @returns Resolved unit
     */
    resolveUnit(
        unitString: string,
        embedding?: number[]
    ): Promise<Result<Unit, DomainError>>;
}
