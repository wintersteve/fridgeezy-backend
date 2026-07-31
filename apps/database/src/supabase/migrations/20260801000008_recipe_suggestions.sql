-- Recipe suggestions: the lightweight cards the model streams before a dish is
-- promoted into a full recipe.
--
-- `canonical_id` is unique outright here (unlike recipes, which key on
-- canonical_id + difficulty) because a suggestion is one card per dish; the
-- difficulty is a property of the card, not part of its identity.

create table if not exists recipe_suggestions
(
    id           uuid primary key                  default gen_random_uuid(),
    name         text                     not null,
    description  text,
    difficulty   difficulty_type,
    created_at   timestamp with time zone not null default now(),
    canonical_id text                     not null,
    name_en      text,
    embedding    vector(1536),
    constraint recipe_suggestions_canonical_id_unique unique (canonical_id)
);

create index if not exists idx_recipe_suggestions_canonical_id on recipe_suggestions using btree (canonical_id);
create index if not exists idx_recipe_suggestions_created_at on recipe_suggestions using btree (created_at);
create index if not exists idx_recipe_suggestions_difficulty on recipe_suggestions using btree (difficulty);
create index if not exists idx_recipe_suggestions_embedding on recipe_suggestions using hnsw (embedding vector_cosine_ops) with (m = '16', ef_construction = '64');

create trigger set_recipe_suggestion_canonical_id_trigger
    before insert or update
    on recipe_suggestions
    for each row
execute function set_recipe_suggestion_canonical_id();

create table if not exists recipe_suggestion_ingredients
(
    id                   uuid primary key                  default gen_random_uuid(),
    recipe_suggestion_id uuid                     not null references recipe_suggestions (id) on delete cascade,
    ingredient_id        uuid                     not null references ingredients (id) on delete cascade,
    created_at           timestamp with time zone not null default now(),
    constraint recipe_suggestion_ingredients_recipe_suggestion_id_ingredie_key unique (recipe_suggestion_id, ingredient_id)
);

create index if not exists idx_recipe_suggestion_ingredients_recipe_id on recipe_suggestion_ingredients using btree (recipe_suggestion_id);
create index if not exists idx_recipe_suggestion_ingredients_ingredient_id on recipe_suggestion_ingredients using btree (ingredient_id);

create table if not exists recipe_suggestion_tags
(
    id                   uuid primary key                  default gen_random_uuid(),
    recipe_suggestion_id uuid                     not null references recipe_suggestions (id) on delete cascade,
    tag_id               uuid                     not null references tags (id) on delete cascade,
    created_at           timestamp with time zone not null default now(),
    constraint recipe_suggestion_tags_unique unique (recipe_suggestion_id, tag_id)
);

create index if not exists idx_recipe_suggestion_tags_recipe_id on recipe_suggestion_tags using btree (recipe_suggestion_id);
create index if not exists idx_recipe_suggestion_tags_tag_id on recipe_suggestion_tags using btree (tag_id);

alter table recipe_suggestions enable row level security;
alter table recipe_suggestion_ingredients enable row level security;
alter table recipe_suggestion_tags enable row level security;

create policy public_read on recipe_suggestions for select using (true);
create policy public_insert on recipe_suggestions for insert with check (true);
create policy public_update on recipe_suggestions for update using (true);
create policy public_delete on recipe_suggestions for delete using (true);
create policy public_read on recipe_suggestion_ingredients for select using (true);
create policy public_insert on recipe_suggestion_ingredients for insert with check (true);
create policy public_update on recipe_suggestion_ingredients for update using (true);
create policy public_delete on recipe_suggestion_ingredients for delete using (true);
create policy public_read on recipe_suggestion_tags for select using (true);
create policy public_insert on recipe_suggestion_tags for insert with check (true);
create policy public_delete on recipe_suggestion_tags for delete using (true);
