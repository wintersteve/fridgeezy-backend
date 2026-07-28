-- Add vector column for embeddings (3072 dimensions for text-embedding-3-large)
alter table recipes add column fts vector(3072);

COMMENT on column recipes.fts is
'Vector embedding of recipe name + description for semantic similarity search. Generated via OpenAI text-embedding-3-large (3072 dimensions).';

-- Create vector index for fast similarity search (IVFFlat supports >2000 dimensions)
-- Note: HNSW has a 2000 dimension limit, so we use IVFFlat for 3072-dim embeddings
-- lists = rows/1000 is a good starting point (will be set dynamically)
-- create index idx_recipes_fts
--     on recipes using ivfflat (fts vector_cosine_ops) with (lists = 100);
--
-- COMMENT on index idx_recipes_fts is
-- 'IVFFlat index for fast cosine similarity search on recipe embeddings. Uses 100 lists (adjust based on table size: rows/1000).';
