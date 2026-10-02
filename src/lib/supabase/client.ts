import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
