-- Enable pgvector extension for vector similarity search
create extension if not exists vector;

COMMENT on extension vector is
'PostgreSQL vector extension for storing and searching embeddings (pgvector)';
