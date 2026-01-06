-- Function to generate OpenAI embeddings via API
create or replace function generate_embedding(input_text TEXT)
returns vector(3072) as $$
declare
    api_key TEXT;
    api_url TEXT := 'https://api.openai.com/v1/embeddings';
    response_data JSONB;
    embedding_array FLOAT[];
    embedding_vector vector(3072);
begin
    -- Get OpenAI API key from Supabase Vault
    -- In cloud Supabase, access vault secrets via vault.decrypted_secrets view
    select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'openai_api_key';

    if api_key is null then
        raise exception 'OpenAI API key not found in Supabase Vault. Please add a secret named "openai_api_key" via the Supabase Dashboard.';
    end if;

    -- Call OpenAI embeddings API using http extension
    select content::jsonb into response_data
    from http((
        'POST',
        api_url,
        ARRAY[
            http_header('Authorization', 'Bearer ' || api_key),
            http_header('Content-Type', 'application/json')
        ],
        'application/json',
        json_build_object(
            'input', input_text,
            'model', 'text-embedding-3-large'
        )::text
    )::http_request);

    -- Extract embedding array from response
    embedding_array := ARRAY(
        select jsonb_array_elements_text(response_data->'data'->0->'embedding')::FLOAT
    );

    -- Convert array to vector type
    embedding_vector := embedding_array::vector(3072);

    return embedding_vector;
exception
    when others then
        raise warning 'Failed to generate embedding for text: %. Error: %',
            LEFT(input_text, 50), SQLERRM;
        return null;
end;
$$ language plpgsql security definer;

COMMENT on function generate_embedding(TEXT) is
'Generates OpenAI text-embedding-3-large vector (3072 dims) for input text. Returns NULL on error. Requires http extension and OpenAI API key.';
