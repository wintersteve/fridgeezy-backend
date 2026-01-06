-- Create function to delete expired pantry items
create or replace function delete_expired_pantry_items()
returns INTEGER as $$
declare
    deleted_count INTEGER;
begin
    -- Delete pantry items that have expired
    delete from pantry_items
    where expires_at is not null
      and expires_at < NOW();

    -- Get count of deleted rows
    get diagnostics deleted_count = ROW_COUNT;

    -- Log the cleanup for monitoring
    raise notice 'Deleted % expired pantry items at %', deleted_count, NOW();

    return deleted_count;
end;
$$ language plpgsql security definer;

COMMENT on function delete_expired_pantry_items() is
'Deletes pantry items where expires_at is in the past. Returns count of deleted items. Runs with elevated privileges (SECURITY DEFINER).';
