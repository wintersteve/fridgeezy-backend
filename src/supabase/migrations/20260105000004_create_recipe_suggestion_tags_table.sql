-- Create recipe_tags junction table for many-to-many relationship
create table recipe_suggestion_tags
(
    id                   UUID primary key     default gen_random_uuid(),
    recipe_suggestion_id UUID        not null references recipe_suggestions (id) on delete cascade,
    tag_id               UUID        not null references tags (id) on delete cascade,
    created_at           TIMESTAMPTZ not null default now(),

    constraint recipe_suggestion_tags_unique unique (recipe_suggestion_id, tag_id)
);

create index idx_recipe_suggestion_tags_recipe_id on recipe_suggestion_tags (recipe_suggestion_id);
create index idx_recipe_suggestion_tags_tag_id on recipe_suggestion_tags (tag_id);

alter table recipe_suggestion_tags enable row level security;

create
policy "public_read"
    on recipe_suggestion_tags for
select using (true);

create
policy "public_insert"
    on recipe_suggestion_tags for insert
    with check (true);

create
policy "public_delete"
    on recipe_suggestion_tags for delete
using (true);
