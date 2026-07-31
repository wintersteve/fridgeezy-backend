-- Profiles and per-user data.
--
-- Everything here is RLS-scoped to the owning profile, unlike the catalog and
-- recipe tables above which are world-readable. The policies all resolve
-- profile_id through `profiles.user_id = auth.uid()` rather than trusting a
-- client-supplied id.

create table if not exists profiles
(
    id                   uuid primary key                  default gen_random_uuid(),
    user_id              uuid                     not null unique references auth.users (id) on delete cascade,
    display_name         text,
    avatar_url           text,
    onboarding_completed boolean                  not null default false,
    created_at           timestamp with time zone not null default now(),
    updated_at           timestamp with time zone not null default now()
);

create index if not exists idx_profiles_user_id on profiles using btree (user_id);

create table if not exists profile_settings
(
    id         uuid primary key                  default gen_random_uuid(),
    profile_id uuid                     not null unique references profiles (id) on delete cascade,
    servings   integer                  not null default 4,
    unit_id    uuid references units (id) on delete set null,
    difficulty difficulty_type                   default 'medium'::difficulty_type,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index if not exists idx_profile_settings_profile_id on profile_settings using btree (profile_id);
create index if not exists idx_profile_settings_unit_id on profile_settings using btree (unit_id);

-- Signup chain, in two links: auth.users -> profiles -> profile_settings.
-- Both are SECURITY DEFINER because the inserting role is the auth service,
-- which has no rights on public.
--
-- The auth.users trigger is easy to miss — it lives outside the public schema,
-- so nothing in this repo references handle_new_user() by name. Dropping it
-- silently breaks signup: the account is created, no profile follows, and the
-- app's onboarding guard sends the user in a circle.
create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
as $function$
begin
    insert into public.profiles (user_id)
    values (NEW.id);
    return NEW;
end;
$function$;

create trigger on_auth_user_created
    after insert
    on auth.users
    for each row
execute function handle_new_user();

-- Every profile gets a settings row the moment it exists, so the app never has
-- to handle "settings not created yet".
create trigger on_profile_created
    after insert
    on profiles
    for each row
execute function handle_new_profile();

create table if not exists profile_dietary_preferences
(
    id         uuid primary key                  default gen_random_uuid(),
    profile_id uuid                     not null references profiles (id) on delete cascade,
    tag_id     uuid                     not null references tags (id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    constraint profile_dietary_preferences_profile_id_tag_id_key unique (profile_id, tag_id)
);

create index if not exists idx_profile_dietary_preferences_profile_id on profile_dietary_preferences using btree (profile_id);
create index if not exists idx_profile_dietary_preferences_tag_id on profile_dietary_preferences using btree (tag_id);

create table if not exists profile_blacklisted_ingredients
(
    id            uuid primary key                  default gen_random_uuid(),
    profile_id    uuid                     not null references profiles (id) on delete cascade,
    ingredient_id uuid                     not null references ingredients (id) on delete cascade,
    created_at    timestamp with time zone not null default now(),
    constraint profile_blacklisted_ingredients_profile_id_ingredient_id_key unique (profile_id, ingredient_id)
);

create index if not exists idx_profile_blacklisted_ingredients_profile_id on profile_blacklisted_ingredients using btree (profile_id);
create index if not exists idx_profile_blacklisted_ingredients_ingredient_id on profile_blacklisted_ingredients using btree (ingredient_id);

create table if not exists profile_recipe_interactions
(
    id               uuid primary key                  default gen_random_uuid(),
    profile_id       uuid                     not null references profiles (id) on delete cascade,
    recipe_id        uuid                     not null references recipes (id) on delete cascade,
    interaction_type recipe_interaction_type  not null,
    created_at       timestamp with time zone not null default now(),
    constraint profile_recipe_interactions_profile_id_recipe_id_interactio_key unique (profile_id, recipe_id, interaction_type)
);

create index if not exists idx_profile_recipe_interactions_profile_id on profile_recipe_interactions using btree (profile_id);
create index if not exists idx_profile_recipe_interactions_recipe_id on profile_recipe_interactions using btree (recipe_id);
create index if not exists idx_profile_recipe_interactions_type on profile_recipe_interactions using btree (interaction_type);

create trigger trg_sync_recipe_favourite_count
    after insert or delete or update
    on profile_recipe_interactions
    for each row
execute function sync_recipe_favourite_count();

-- A user's private edit of a shared recipe. `recipe_id` is the variant copy,
-- `base_recipe_id` the dish it was derived from.
create table if not exists recipe_variants
(
    id             uuid primary key                  default gen_random_uuid(),
    profile_id     uuid                     not null references profiles (id) on delete cascade,
    base_recipe_id uuid                     not null references recipes (id) on delete cascade,
    recipe_id      uuid                     not null references recipes (id) on delete cascade,
    label          text                     not null,
    created_at     timestamp with time zone not null default now(),
    constraint recipe_variants_profile_id_recipe_id_key unique (profile_id, recipe_id)
);

create index if not exists idx_recipe_variants_profile_base on recipe_variants using btree (profile_id, base_recipe_id);
create index if not exists idx_recipe_variants_recipe_id on recipe_variants using btree (recipe_id);

alter table profiles enable row level security;
alter table profile_settings enable row level security;
alter table profile_dietary_preferences enable row level security;
alter table profile_blacklisted_ingredients enable row level security;
alter table profile_recipe_interactions enable row level security;
alter table recipe_variants enable row level security;

create policy users_read_own_profile on profiles for select using ((auth.uid() = user_id));
create policy users_update_own_profile on profiles for update using ((auth.uid() = user_id));

create policy users_manage_own_settings on profile_settings for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
create policy users_manage_own_dietary_preferences on profile_dietary_preferences for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
create policy users_manage_own_blacklisted_ingredients on profile_blacklisted_ingredients for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
create policy users_manage_own_recipe_interactions on profile_recipe_interactions for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
create policy users_manage_own_recipe_variants on recipe_variants for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
