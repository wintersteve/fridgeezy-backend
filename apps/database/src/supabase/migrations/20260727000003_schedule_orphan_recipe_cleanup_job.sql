-- Reclaim AI-generated recipe rows nobody kept. A generated recipe (is_generated)
-- older than the retention window with no reference from any user-facing table is
-- a true orphan: the user streamed a variant/suggestion, looked, and moved on
-- without saving. Child rows (recipe_ingredients/instructions/tags) cascade.
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
          AND NOT EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM profile_recipe_interactions pri WHERE pri.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipe_suggestions rs WHERE rs.promoted_to_recipe_id = r.id)
        RETURNING r.id
    )
    SELECT count(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
end;
$$ language plpgsql;

-- Run daily at 03:00 UTC (off-peak, after the midnight pantry sweep).
select cron.schedule(
    'delete-orphan-generated-recipes',
    '0 3 * * *',
    'SELECT delete_orphan_generated_recipes();'
);

-- Note: To view scheduled jobs:      SELECT * FROM cron.job;
-- Note: To view job run history:     SELECT * FROM cron.job_run_details ORDER BY start_time DESC;
-- Note: To unschedule if needed:     SELECT cron.unschedule('delete-orphan-generated-recipes');
