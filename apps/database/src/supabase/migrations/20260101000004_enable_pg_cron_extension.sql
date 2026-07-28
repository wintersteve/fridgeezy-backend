-- Enable pg_cron extension for scheduled tasks
create extension if not exists pg_cron;

COMMENT on extension pg_cron is
'PostgreSQL job scheduler for running periodic tasks. Enables scheduled cleanup of expired pantry items.';
