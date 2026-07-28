-- Phase 1 (embedding consolidation) — slice 3: cleanup + indexes.
--
-- After slices 1 / 2a / 2b, no trigger or search function embeds inside Postgres:
-- every query and stored embedding is computed by the application on
-- text-embedding-3-small (1536). This migration removes the now-unused in-DB
-- embedding functions and adds the HNSW indexes that 1536-dim vectors allow
-- (pgvector caps HNSW/IVFFlat at 2000 dims — the reason the old 3072/large columns
-- were unindexed).

-- 1. Drop the unused in-Postgres embedding functions (the OpenAI http-extension
--    calls). Nothing references them at runtime anymore.
drop function if exists generate_embedding(text);
drop function if exists generate_embedding_small(text);

-- 2. HNSW cosine indexes on the 1536 vector columns that lack them.
--    (units.embedding and tags.embedding already have theirs.)
--    Columns are populated by the app on write and by the one-time backfills
--    (embed-recipes / embed-suggestions); the index fills in as rows are written.
create index if not exists idx_recipes_fts
    on recipes using hnsw (fts vector_cosine_ops)
    with (m = 16, ef_construction = 64);

create index if not exists idx_recipe_suggestions_embedding
    on recipe_suggestions using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);

create index if not exists idx_ingredients_embedding
    on ingredients using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);

create index if not exists idx_categories_embedding
    on categories using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);
