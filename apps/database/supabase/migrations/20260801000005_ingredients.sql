-- Ingredients and their aliases.
--
-- Split from the other reference tables because ingredients depend on
-- categories, carry the expiry metadata, and are the table everything else
-- resolves against.

create table if not exists ingredients
(
    id                      uuid primary key                  default gen_random_uuid(),
    parent_id               uuid references ingredients (id) on delete set null,
    canonical_id            text                     not null unique,
    name                    text                     not null unique,
    category_id             uuid references categories (id) on delete set null,
    description             text,
    image_url               text,
    nutritional_info        jsonb,
    storage_tips            text,
    shelf_life              text,
    created_at              timestamp with time zone not null default now(),
    embedding               vector(1536),
    expires_by_default      boolean                  not null default false,
    default_shelf_life_days integer,
    -- A shelf life is meaningful only for something that expires, and an
    -- expiring ingredient must say how long it keeps.
    constraint ingredients_shelf_life_check check (
        ((expires_by_default = false) and (default_shelf_life_days is null))
            or ((expires_by_default = true) and (default_shelf_life_days > 0))
        )
);

create index if not exists idx_ingredients_category_id on ingredients using btree (category_id);
create index if not exists idx_ingredients_name on ingredients using btree (name);
create index if not exists idx_ingredients_parent_id on ingredients using btree (parent_id);
create index if not exists idx_ingredients_expires_by_default on ingredients using btree (expires_by_default);
create index if not exists idx_ingredients_nutritional_info on ingredients using gin (nutritional_info);
create index if not exists idx_ingredients_embedding on ingredients using hnsw (embedding vector_cosine_ops) with (m = '16', ef_construction = '64');

create trigger set_ingredient_canonical_id_trigger
    before insert or update
    on ingredients
    for each row
execute function set_ingredient_canonical_id();

create table if not exists ingredient_aliases
(
    id            uuid primary key                  default gen_random_uuid(),
    ingredient_id uuid                     not null references ingredients (id) on delete cascade,
    alias         text                     not null unique,
    created_at    timestamp with time zone not null default now()
);

create index if not exists idx_ingredient_aliases_alias on ingredient_aliases using btree (alias);
create index if not exists idx_ingredient_aliases_ingredient_id on ingredient_aliases using btree (ingredient_id);

alter table ingredients enable row level security;
alter table ingredient_aliases enable row level security;

create policy public_read on ingredients for select using (true);
create policy public_insert on ingredients for insert with check (true);
create policy public_read on ingredient_aliases for select using (true);
create policy public_insert on ingredient_aliases for insert with check (true);
