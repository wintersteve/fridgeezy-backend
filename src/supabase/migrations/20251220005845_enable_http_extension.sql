-- Enable HTTP extension for making API requests from PostgreSQL
create extension if not exists http;

COMMENT on extension http is
'HTTP client extension for making API requests from PostgreSQL (required for OpenAI embeddings)';
