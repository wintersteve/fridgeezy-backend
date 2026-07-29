-- Record which suggestion a generated recipe came from, so promoting the same
-- suggestion twice resolves to the recipe that already exists instead of paying
-- for a second generation.
--
-- Promotion deletes the suggestion row once the recipe is persisted, which is
-- what made this necessary: a client that dropped out mid-stream (before it
-- could record the new recipe locally) came back to a card whose promote call
-- 404s, on a recipe that does exist. Deliberately a plain uuid with no foreign
-- key — the reference has to outlive the row it points at.
alter table recipes add column if not exists source_suggestion_id UUID;

create index if not exists recipes_source_suggestion_id_idx
    on recipes (source_suggestion_id)
    where source_suggestion_id is not null;
