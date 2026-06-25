import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-side only — never import in client components
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}