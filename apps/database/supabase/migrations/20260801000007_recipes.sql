-- Recipes and everything hanging off them.
--
-- `fts` is a vector(1536) despite the name — it started life as a tsvector and
-- became the dish-signature embedding when search moved to pgvector. The column
-- name was kept rather than churn every caller.
--
-- `source_suggestion_id` intentionally has NO foreign key: a recipe outlives the
-- suggestion it was promoted from, and suggestions get deduped and deleted.

create table if not exists recipes
(
    id                   uuid primary key                  default gen_random_uuid(),
    name                 text                     not null,
    description          text,
    difficulty           difficulty_type,
    servings             integer                  not null default 4,
    prep_time            text,
    cook_time            text,
    kcal                 integer,
    carbs                integer,
    protein              integer,
    fat                  integer,
    tips                 text[],
    image                text,
    created_at           timestamp with time zone not null default now(),
    updated_at           timestamp with time zone not null default now(),
    name_en              text,
    is_generated         boolean                  not null default false,
    base_recipe_id       uuid references recipes (id) on delete set null,
    fts                  vector(1536),
    short_description    text,
    favourite_count      integer                  not null default 0,
    -- GENERATED, not a plain column: recipes have no BEFORE INSERT trigger the
    -- way ingredients/tags/units do, so the canonical id is derived by the
    -- database itself and can never drift from the name. This is why
    -- `normalize_to_canonical_id` must be declared before this table.
    canonical_id         text generated always as (normalize_to_canonical_id(name)) stored,
    source_suggestion_id uuid
);

-- One canonical dish per difficulty, and only among BASE recipes: a user's
-- variant is a copy of a dish they already have, so it must not collide with
-- the original. Partial + unique, which is why it is an index rather than a
-- table constraint.
create unique index if not exists recipes_canonical_id_difficulty_unique
    on recipes using btree (canonical_id, difficulty)
    where (base_recipe_id is null);

create index if not exists idx_recipes_canonical_id on recipes using btree (canonical_id);
create index if not exists idx_recipes_base_recipe_id on recipes using btree (base_recipe_id) where (base_recipe_id is not null);
create index if not exists recipes_source_suggestion_id_idx on recipes using btree (source_suggestion_id) where (source_suggestion_id is not null);
create index if not exists idx_recipes_favourite_count on recipes using btree (favourite_count desc);
create index if not exists idx_recipes_fts on recipes using hnsw (fts vector_cosine_ops) with (m = '16', ef_construction = '64');

create table if not exists recipe_ingredients
(
    id            uuid primary key                  default gen_random_uuid(),
    recipe_id     uuid                     not null references recipes (id) on delete cascade,
    ingredient_id uuid                     not null references ingredients (id) on delete cascade,
    quantity      numeric(10, 3)           not null,
    -- No ON DELETE: a unit still in use must not be removable.
    unit_id       uuid                     not null references units (id),
    created_at    timestamp with time zone not null default now(),
    comment       text,
    constraint recipe_ingredients_recipe_id_ingredient_id_key unique (recipe_id, ingredient_id)
);

create index if not exists idx_recipe_ingredients_recipe_id on recipe_ingredients using btree (recipe_id);
create index if not exists idx_recipe_ingredients_ingredient_id on recipe_ingredients using btree (ingredient_id);
create index if not exists idx_recipe_ingredients_unit_id on recipe_ingredients using btree (unit_id);

create table if not exists recipe_instructions
(
    id                uuid primary key                  default gen_random_uuid(),
    recipe_id         uuid                     not null references recipes (id) on delete cascade,
    step_number       integer                  not null,
    instruction_text  text                     not null,
    cooking_action_id uuid references cooking_actions (id) on delete set null,
    duration_minutes  integer,
    temperature       jsonb,
    -- Denormalised on purpose: the reader highlights ingredients per step, and
    -- a join table for that would be read on every step render.
    ingredient_refs   uuid[],
    tips              text,
    created_at        timestamp with time zone not null default now(),
    constraint recipe_instructions_unique_step unique (recipe_id, step_number),
    constraint recipe_instructions_step_number_positive check ((step_number > 0)),
    constraint recipe_instructions_duration_positive check (((duration_minutes is null) or (duration_minutes > 0)))
);

create index if not exists idx_recipe_instructions_recipe_id on recipe_instructions using btree (recipe_id);
create index if not exists idx_recipe_instructions_step_number on recipe_instructions using btree (recipe_id, step_number);
create index if not exists idx_recipe_instructions_cooking_action_id on recipe_instructions using btree (cooking_action_id);
create index if not exists idx_recipe_instructions_ingredient_refs on recipe_instructions using gin (ingredient_refs);

create table if not exists recipe_tags
(
    id         uuid primary key                  default gen_random_uuid(),
    recipe_id  uuid                     not null references recipes (id) on delete cascade,
    tag_id     uuid                     not null references tags (id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    constraint recipe_tags_unique unique (recipe_id, tag_id)
);

create index if not exists idx_recipe_tags_recipe_id on recipe_tags using btree (recipe_id);
create index if not exists idx_recipe_tags_tag_id on recipe_tags using btree (tag_id);

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_instructions enable row level security;
alter table recipe_tags enable row level security;

create policy public_read on recipes for select using (true);
create policy public_insert on recipes for insert with check (true);
create policy public_read on recipe_ingredients for select using (true);
create policy public_insert on recipe_ingredients for insert with check (true);
create policy public_read on recipe_instructions for select using (true);
create policy public_insert on recipe_instructions for insert with check (true);
create policy public_update on recipe_instructions for update using (true);
create policy public_delete on recipe_instructions for delete using (true);
create policy public_read on recipe_tags for select using (true);
create policy public_insert on recipe_tags for insert with check (true);
create policy public_delete on recipe_tags for delete using (true);
