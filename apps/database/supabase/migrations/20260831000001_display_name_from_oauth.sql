-- The name comes from the provider now, not from a screen.
--
-- `display_name` was collected by an onboarding step that was the first thing a
-- brand new account saw and the only one of the five that fed nothing: the
-- column was write-only, read back by no surface in the app (the home greeting
-- is the daypart clock, deliberately). The screen is gone; the column stays,
-- because Apple and Google hand us a name for free in the identity payload and
-- a greeting may yet want one.
--
-- Nothing here invents a name. The email-code path carries no metadata, so
-- those profiles keep a null `display_name` — which is the honest answer, and
-- what every reader has to handle anyway for the accounts that predate this.
-- Split out so the backfill below and the trigger cannot disagree about which
-- keys count. Google sends `full_name` and `name`; Apple sends `full_name`, and
-- only on the very first authorisation.
--
-- Every key is type-checked rather than read with `->>`, because `full_name`
-- arrives in two different shapes: a string from the OAuth redirect flow, and
-- Apple's `{firstName, lastName}` OBJECT through a native `signInWithIdToken`.
-- Read blind, the second serialises its own JSON into the column as if that
-- were a person's name.
create or replace function public.display_name_from_identity(meta jsonb)
    returns text
    language sql
    immutable
as $function$
    select nullif(btrim(coalesce(
        case when jsonb_typeof(meta -> 'full_name') = 'string'
            then meta ->> 'full_name' end,
        case when jsonb_typeof(meta -> 'name') = 'string'
            then meta ->> 'name' end,
        -- Apple, natively: full_name is an object of its parts.
        case when jsonb_typeof(meta -> 'full_name') = 'object'
            then nullif(btrim(concat_ws(' ',
                meta -> 'full_name' ->> 'firstName',
                meta -> 'full_name' ->> 'lastName')), '') end,
        nullif(btrim(concat_ws(' ',
            case when jsonb_typeof(meta -> 'given_name') = 'string'
                then meta ->> 'given_name' end,
            case when jsonb_typeof(meta -> 'family_name') = 'string'
                then meta ->> 'family_name' end)), '')
    )), '');
$function$;

create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
as $function$
declare
    meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
begin
    insert into public.profiles (user_id, display_name)
    values (NEW.id, public.display_name_from_identity(meta));
    return NEW;
end;
$function$;

-- Accounts that signed in with a provider before this existed. Only ever fills
-- a null: a name somebody typed on the old screen is theirs and outranks
-- whatever Google has on file.
update public.profiles p
set display_name = public.display_name_from_identity(u.raw_user_meta_data)
from auth.users u
where u.id = p.user_id
  and p.display_name is null
  and public.display_name_from_identity(u.raw_user_meta_data) is not null;
