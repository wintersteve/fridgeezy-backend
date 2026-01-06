-- Create recipe instructions table with normalized structure
create table recipe_instructions
(
    id                UUID primary key     default gen_random_uuid(),
    recipe_id         UUID        not null references recipes (id) on delete cascade,
    step_number       INTEGER     not null,
    instruction_text  TEXT        not null,
    cooking_action_id UUID references cooking_actions (id) on delete set null,
    duration_minutes  INTEGER,
    temperature       JSONB,
    ingredient_refs   UUID[],
    tips              TEXT,
    created_at        TIMESTAMPTZ not null default now(),

    constraint recipe_instructions_unique_step unique (recipe_id, step_number),
    constraint recipe_instructions_step_number_positive check (step_number > 0),
    constraint recipe_instructions_duration_positive check (duration_minutes is null or duration_minutes > 0)
);

COMMENT on column recipe_instructions.step_number is
'Sequence number for ordering instruction steps (1, 2, 3...).';

COMMENT on column recipe_instructions.instruction_text is
'The actual instruction text for this step.';

COMMENT on column recipe_instructions.cooking_action_id is
'Optional reference to the primary cooking action for this step.';

COMMENT on column recipe_instructions.duration_minutes is
'Optional duration for this step in minutes (e.g., 15 for "simmer for 15 minutes").';

COMMENT on column recipe_instructions.temperature is
'Optional cooking temperature as JSONB supporting both F and C (e.g., {"value": 350, "unit": "F"}).';

COMMENT on column recipe_instructions.ingredient_refs is
'Array of ingredient UUIDs mentioned in this step for highlighting/substitution.';

COMMENT on column recipe_instructions.tips is
'Optional step-specific tips or notes.';

create index idx_recipe_instructions_recipe_id on recipe_instructions (recipe_id);
create index idx_recipe_instructions_cooking_action_id on recipe_instructions (cooking_action_id);
create index idx_recipe_instructions_step_number on recipe_instructions (recipe_id, step_number);
create index idx_recipe_instructions_ingredient_refs on recipe_instructions using gin (ingredient_refs);

alter table recipe_instructions enable row level security;

create policy "public_read"
    on recipe_instructions for select
    using (true);

create policy "public_insert"
    on recipe_instructions for insert
    with check (true);

create policy "public_update"
    on recipe_instructions for update
    using (true);

create policy "public_delete"
    on recipe_instructions for delete
    using (true);
