/// <reference types="astro/client" />

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { UserRole } from "./lib/types";

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  // Server-only — never PUBLIC_-prefixed, never inlined into a client bundle.
  // Read only by src/lib/supabase/admin.ts.
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// This file has top-level imports above, which makes TypeScript treat it as
// a module — a bare `declare namespace App` would then be scoped to this
// module instead of merging with the real global `App.Locals` Astro reads
// from, silently leaving `Astro.locals` untyped everywhere. `declare global`
// is required so the augmentation actually applies project-wide.
declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      user: User | null;
      // Populated once per request by middleware.ts for any authenticated
      // user — read this instead of re-querying `profiles` per page.
      role: UserRole | null;
    }
  }
}
