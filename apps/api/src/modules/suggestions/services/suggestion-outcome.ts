import { EnrichedSuggestionResponseDto } from "@fridgeezy/schemas";

import { RecipeSummary } from "../../recipes/services/fetch-recipe-summary";

/**
 * What became of one generated suggestion.
 *
 * `existing_recipe` is not a failure — it means the dish the model proposed is
 * already in the catalog as a full recipe, so no suggestion was (or should be)
 * created for it. Callers decide what to show: the chat search surfaces the
 * recipe, the batch generator drops the card so the user is never re-offered a
 * dish they already have.
 *
 * Lives in its own module because both `persistOrReuseSuggestion` (which
 * produces it) and `suggestion-batch` (which hands one sibling's outcome to
 * another) need the type, and importing it from the producer would make those
 * two modules cyclic.
 */
export type SuggestionOutcome =
    | {
          kind: "suggestion";
          suggestion: EnrichedSuggestionResponseDto;
          /**
           * The row already existed — dedup resolved to it rather than
           * inserting. The single-suggestion endpoint wants it anyway (asking
           * for a dish you already have should return that dish), but the batch
           * feed must not render a card the same response has already shown.
           */
          reused?: boolean;
      }
    | { kind: "existing_recipe"; recipe: RecipeSummary }
    | {
          kind: "dropped";
          reason:
              | "unauthentic"
              /**
               * Out of scope: a drink, not a dish.
               *
               * Split from `unauthentic` because the two behave differently on
               * RETRY. An unauthentic dish is one bad roll of the dice — asking
               * the model again for the same request plausibly yields a real
               * dish, which is what the top-up pass is for. A drink is a
               * property of the REQUEST: ask for "mojito" again and you get a
               * mojito again. Re-running the pass spends a second generation
               * call plus another round of authenticity calls to drop the same
               * four items, so the caller has to be able to tell these apart.
               */
              | "not_food"
              | "persist_failed"
              | "invalid"
              /** Collapsed into an earlier dish in the SAME batch. */
              | "duplicate";
      };
