-- Create recipe_tags junction table for many-to-many relationship
create table recipe_tags
(
    id         UUID primary key     default gen_random_uuid(),
    recipe_id  UUID        not null references recipes (id) on delete cascade,
    tag_id     UUID        not null references tags (id) on delete cascade,
    created_at TIMESTAMPTZ not null default now(),

    constraint recipe_tags_unique unique (recipe_id, tag_id)
);

create index idx_recipe_tags_recipe_id on recipe_tags (recipe_id);
create index idx_recipe_tags_tag_id on recipe_tags (tag_id);

alter table recipe_tags enable row level security;

create
policy "public_read"
    on recipe_tags for
select using (true);

create
policy "public_insert"
    on recipe_tags for insert
    with check (true);

create
policy "public_delete"
    on recipe_tags for delete
using (true);
