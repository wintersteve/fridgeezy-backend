import { Database } from "@fridgeezy/types";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");

if (!process.env.SUPABASE_ANON_KEY)
    throw new Error("Missing SUPABASE_ANON_KEY");

export const supabase = createClient<Database>(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient<Database>(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);
