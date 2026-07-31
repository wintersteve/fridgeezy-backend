import {
    DomainError,
    failure,
    IUnitsRepository,
    NotFoundError,
    PersistenceError,
    Result,
    success,
    UnitVectorMatch,
} from "@fridgeezy/domain";
import { Unit } from "@fridgeezy/types";

import { supabase } from "../../client";

/**
 * Normalizes a string to canonical_id format.
 * ⚠️ The comment this replaces claimed to match the PostgreSQL
 * `normalize_to_canonical_id` function. It does not: this trims whitespace and
 * strips leading/trailing underscores, and the SQL function does neither. Since
 * the result is looked up against the SQL-generated `units.canonical_id`, a unit
 * string with edge whitespace or punctuation resolves differently on each side
 * — `" g "` is `g` here and `_g_` in the column.
 *
 * Left as-is rather than "fixed": every real unit string is a bare token
 * (`g`, `ml`, `tbsp`) so the divergence has no live effect, `resolveUnit` falls
 * through to abbreviation and embedding lookups anyway, and tightening it would
 * change unit resolution without a test to catch the fallout. Decide it
 * deliberately — see `sqlCanonicalId` in recipes.repository.ts for the rule this
 * would need to adopt.
 */
function normalizeToCanonicalId(str: string): string {
    return str
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

// Type alias for search_units RPC result
type SearchUnitsResult = {
    id: string;
    name: string;
    abbreviation: string;
    canonical_id: string;
    similarity: number;
};

export class UnitsRepository implements IUnitsRepository {
    async findByCanonicalId(
        canonicalId: string
    ): Promise<Result<Unit | null, DomainError>> {
        try {
            // Note: canonical_id column added in migration 20260131000001
            // After regenerating types, remove the type assertion
            const { data, error } = await (supabase as any)
                .from("units")
                .select("*")
                .eq("canonical_id", canonicalId)
                .maybeSingle();

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data as Unit | null);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find unit by canonical_id: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findByAbbreviation(
        abbreviation: string
    ): Promise<Result<Unit | null, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("units")
                .select("*")
                .eq("abbreviation", abbreviation)
                .maybeSingle();

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data as Unit | null);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find unit by abbreviation: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findBestMatch(
        embedding: number[]
    ): Promise<Result<UnitVectorMatch, DomainError>> {
        try {
            // Note: search_units function added in migration 20260131000003
            // After regenerating types, remove the type assertion
            const { data, error } = await (supabase as any).rpc("search_units", {
                query_embedding: JSON.stringify(embedding),
                match_count: 1,
            });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const results = data as SearchUnitsResult[];

            if (!results || results.length === 0) {
                return failure(
                    new PersistenceError(
                        "No units found - ensure unit embeddings are populated"
                    )
                );
            }

            const { data: unitData, error: unitError } = await supabase
                .from("units")
                .select("*")
                .eq("id", results[0].id)
                .single();

            if (unitError) {
                return failure(new PersistenceError(unitError.message));
            }

            return success({
                unit: unitData as Unit,
                similarity: results[0].similarity,
            });
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to perform vector search: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async resolveUnit(
        unitString: string,
        embedding?: number[]
    ): Promise<Result<Unit, DomainError>> {
        const canonicalId = normalizeToCanonicalId(unitString);

        // 1. Try canonical_id lookup
        const canonicalResult = await this.findByCanonicalId(canonicalId);
        if (!canonicalResult.success) {
            return canonicalResult;
        }
        if (canonicalResult.value) {
            return success(canonicalResult.value);
        }

        // 2. Try abbreviation lookup
        const abbrevResult = await this.findByAbbreviation(unitString);
        if (!abbrevResult.success) {
            return abbrevResult;
        }
        if (abbrevResult.value) {
            return success(abbrevResult.value);
        }

        // 3. Try vector search if embedding provided
        if (embedding) {
            const vectorResult = await this.findBestMatch(embedding);
            if (vectorResult.success) {
                return success(vectorResult.value.unit);
            }
        }

        // No match found
        return failure(
            new NotFoundError("Unit", {
                unitString,
                canonicalId,
                message:
                    "Unit not found via canonical_id, abbreviation, or vector search",
            })
        );
    }
}
