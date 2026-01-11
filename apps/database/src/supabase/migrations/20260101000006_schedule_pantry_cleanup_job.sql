-- Schedule daily cleanup of expired pantry items at midnight UTC
select cron.schedule(
    'delete-expired-pantry-items',  -- job name
    '0 0 * * *',                     -- cron expression: daily at midnight UTC
    'SELECT delete_expired_pantry_items();'  -- SQL command to run
);

-- Note: To view scheduled jobs:      SELECT * FROM cron.job;
-- Note: To view job run history:     SELECT * FROM cron.job_run_details ORDER BY start_time DESC;
-- Note: To unschedule if needed:     SELECT cron.unschedule('delete-expired-pantry-items');
