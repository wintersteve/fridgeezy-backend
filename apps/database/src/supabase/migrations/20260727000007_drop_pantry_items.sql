-- Remove the pantry_items feature (unused by client and backend).
-- Unschedule the daily cleanup cron job (guarded; no-op if not scheduled).
delete from cron.job where jobname = 'delete-expired-pantry-items';

-- Drop the table (cascades its expiration trigger) and standalone functions.
drop table if exists pantry_items cascade;
drop function if exists delete_expired_pantry_items();
drop function if exists set_pantry_item_expiration();
