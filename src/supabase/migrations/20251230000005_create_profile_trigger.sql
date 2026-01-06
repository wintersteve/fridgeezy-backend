-- Function to automatically create a profile when a new user signs up
create
or REPLACE function public.handle_new_user()
returns trigger as $$
begin
insert into public.profiles (user_id)
values (NEW.id);
return NEW;
end;
$$
language plpgsql security definer;

-- Trigger to call the function after a new user is created
create trigger on_auth_user_created
    after insert
    on auth.users
    for each row execute FUNCTION public.handle_new_user();
