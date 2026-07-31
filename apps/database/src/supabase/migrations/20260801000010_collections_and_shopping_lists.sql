-- Collections and shopping lists: user-owned groupings of recipes.

create table if not exists collections
(
    id          uuid primary key                  default gen_random_uuid(),
    profile_id  uuid                     not null references profiles (id) on delete cascade,
    title       text                     not null,
    description text,
    created_at  timestamp with time zone not null default now(),
    updated_at  timestamp with time zone not null default now(),
    icon        text
);

create index if not exists idx_collections_profile_id on collections using btree (profile_id);

create table if not exists collection_recipes
(
    id            uuid primary key                  default gen_random_uuid(),
    collection_id uuid                     not null references collections (id) on delete cascade,
    recipe_id     uuid                     not null references recipes (id) on delete cascade,
    created_at    timestamp with time zone not null default now(),
    constraint collection_recipes_collection_id_recipe_id_key unique (collection_id, recipe_id)
);

create index if not exists idx_collection_recipes_collection_id on collection_recipes using btree (collection_id);
create index if not exists idx_collection_recipes_recipe_id on collection_recipes using btree (recipe_id);

create table if not exists shopping_lists
(
    id         uuid primary key                  default gen_random_uuid(),
    profile_id uuid                     not null references profiles (id) on delete cascade,
    recipe_id  uuid                     not null references recipes (id) on delete cascade,
    name       text,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index if not exists idx_shopping_lists_profile_id on shopping_lists using btree (profile_id);
create index if not exists idx_shopping_lists_recipe_id on shopping_lists using btree (recipe_id);

alter table collections enable row level security;
alter table collection_recipes enable row level security;
alter table shopping_lists enable row level security;

create policy users_manage_own_collections on collections for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));

-- Reached through the collection, since collection_recipes has no profile_id.
create policy users_manage_own_collection_recipes on collection_recipes for all
    using ((collection_id in (select collections.id
                              from collections
                              where (collections.profile_id in (select profiles.id
                                                                from profiles
                                                                where (profiles.user_id = auth.uid()))))));

create policy users_manage_own_shopping_lists on shopping_lists for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));
