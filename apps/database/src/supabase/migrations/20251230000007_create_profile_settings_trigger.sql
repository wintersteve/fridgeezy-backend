-- Function to automatically create settings when a profile is created
create
or replace function public.handle_new_profile()
returns trigger as $$
begin
    insert into public.profile_settings (profile_id)
    values (NEW.id);
    return NEW;
end;
$$
language plpgsql security definer;

-- Trigger to call the function after a new profile is created
create trigger on_profile_created
    after insert
    on profiles
    for each row execute function public.handle_new_profile();
