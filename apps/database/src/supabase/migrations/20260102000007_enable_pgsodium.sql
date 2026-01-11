-- Enable pgsodium extension for accessing Supabase Vault secrets
-- This extension provides the vault.decrypted_secrets view needed to retrieve secrets in cloud Supabase
create extension if not exists pgsodium;

COMMENT on extension pgsodium is
'Enables access to Supabase Vault secrets via vault.decrypted_secrets view. Required for secure secret management in cloud Supabase.';
