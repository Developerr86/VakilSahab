import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-side only — never import in client components
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // Next.js patches global fetch and serves its Data Cache inside route
      // handlers; supabase-js selects are GETs and were returning minutes-old
      // snapshots (jobs stuck "queued" after completion). Bypass it.
      global: {
        fetch: (input: any, init: any) => fetch(input, { ...init, cache: "no-store" }),
      },
    } as any
  );
}
