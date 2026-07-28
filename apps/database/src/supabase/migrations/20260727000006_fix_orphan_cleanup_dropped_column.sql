-- Fix delete_orphan_generated_recipes(), which referenced
-- `recipe_suggestions.promoted_to_recipe_id` — a column dropped back in
-- 20260126000001. plpgsql resolves column references at execution time, so the
-- function created fine and would only have blown up on its first 03:00 cron
-- run, leaving generated rows to accumulate silently.
--
-- The guard is obsolete rather than misspelled: promotion now DELETES the
-- suggestion once the recipe persists (see the promote usecase), so a promoted
-- recipe has no surviving suggestion to point back at it. A promoted recipe
-- nobody saved, cooked, collected or shopped from is an orphan by the same
-- definition as any other generated row, so it is now swept like one.
--
-- Also adds a guard the variant work needs: `recipes.base_recipe_id` is
-- `on delete set null`, so sweeping a base out from under a surviving variant
-- would null the variant's lineage and pop it back into search results. Keep a
-- base for as long as any row claims it as its base; once that variant is
-- itself swept, the next run collects the base.
create or replace function delete_orphan_generated_recipes()
returns INTEGER as $$
declare
    v_deleted INTEGER;
begin
    WITH removed AS (
        DELETE FROM recipes r
        WHERE r.is_generated = true
          AND r.created_at < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM recipe_variants v WHERE v.recipe_id = r.id OR v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipes v WHERE v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM profile_recipe_interactions pri WHERE pri.recipe_id = r.id)
        RETURNING r.id
    )
    SELECT count(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
end;
$$ language plpgsql;
