import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — ONLY for Admin API calls (inviteUserByEmail, etc.)
// that need to bypass RLS/session context entirely. Never session-bound,
// never given cookies, never imported by anything client-side. Import this
// only from src/actions/index.ts (a server-only Astro Actions file) so the
// service-role key can never reach a browser bundle. Astro/Vite only inlines
// PUBLIC_-prefixed env vars into client code, so SUPABASE_SERVICE_ROLE_KEY
// (deliberately unprefixed) is server-only by construction — see server.ts
// for the equivalent, publishable-key, cookie-bound client used everywhere
// else in the app.
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export function createAdminClient() {
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
