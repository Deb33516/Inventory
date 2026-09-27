import { defineMiddleware } from "astro:middleware";
import { createClient } from "./lib/supabase/server";
import type { UserRole } from "./lib/types";

const PROTECTED_PREFIXES = ["/account", "/inventory"];

// Prefixes that require not just a session, but a specific role. Checked
// only when the path actually matches, so routes that don't need it (e.g.
// /account) avoid the extra profiles lookup.
const ROLE_GATED_PREFIXES: Record<string, UserRole[]> = {
  "/inventory": ["inventory_staff", "admin", "super_admin"],
};

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient({
    request: context.request,
    cookies: context.cookies,
  });

  // getUser() revalidates the token against Supabase Auth rather than
  // trusting the (unverified) session stored in cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  context.locals.supabase = supabase;
  context.locals.user = user;

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    matchesPrefix(context.url.pathname, prefix)
  );

  if (isProtected && !user) {
    const redirectTo = encodeURIComponent(
      context.url.pathname + context.url.search
    );
    return context.redirect(`/login?redirect=${redirectTo}`);
  }

  const gatedPrefix = Object.keys(ROLE_GATED_PREFIXES).find((prefix) =>
    matchesPrefix(context.url.pathname, prefix)
  );

  if (gatedPrefix && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const allowedRoles = ROLE_GATED_PREFIXES[gatedPrefix];

    if (!profile || !allowedRoles.includes(profile.role as UserRole)) {
      return context.redirect("/");
    }
  }

  return next();
});
