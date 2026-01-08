create
or replace function has_user(email varchar) returns boolean
    language plpgsql
    security definer as
$$
begin
return exists ( select 1
                from auth.users as u
                where u.email = has_user.email );
end;
$$