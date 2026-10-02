import { defineMiddleware } from "astro:middleware";
import { createClient } from "./lib/supabase/server";
import type { UserRole } from "./lib/types";
import { ROLE_GATED_PREFIXES, ROLE_DASHBOARD, CUSTOMER_ONLY_PREFIXES } from "./lib/roles";

// /cart is deliberately NOT protected — it's a pure localStorage read
// with no DB call, browsable while signed out (like any real cart).
// /checkout is protected since it actually calls place_order(). /super is
// Super Admin's own application area (routing/shell foundation only for
// now, no pages yet — see roles.ts's APP_SECTIONS/ROLE_DASHBOARD and
// NavSidebar.astro's SUPER_NAV) — listed here explicitly since this array
// isn't derived from APP_SECTIONS, so an unauthenticated visitor still
// gets redirected to /login?redirect=/super instead of falling through.
const PROTECTED_PREFIXES = ["/account", "/inventory", "/crm", "/checkout", "/sales", "/admin", "/super"];

function matchesPrefix(pathname: string, prefix: string) {
  const cleanPath = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const cleanPrefix = prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  return cleanPath === cleanPrefix || cleanPath.startsWith(cleanPrefix + "/");
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

  // Fetched once per request (not per-page) so every page and AppHeader
  // can read the viewer's role off Astro.locals without a duplicate query.
  // Only needed for an authenticated request — anonymous visitors get null.
  let role: UserRole | null = null;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    role = (profile?.role as UserRole) ?? null;
  }
  context.locals.role = role;

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    matchesPrefix(context.url.pathname, prefix)
  );

  if (isProtected && !user) {
    const redirectTo = encodeURIComponent(
      context.url.pathname + context.url.search
    );
    return context.redirect(`/login?redirect=${redirectTo}`);
  }

  // Customer-only routes: /account, /cart, /checkout.
  // Staff/admin users attempting to visit are redirected directly to their role dashboard.
  const isCustomerOnly = CUSTOMER_ONLY_PREFIXES.some((prefix) => matchesPrefix(context.url.pathname, prefix));

  if (isCustomerOnly && role && role !== "customer") {
    return context.redirect(ROLE_DASHBOARD[role]);
  }

  const gatedPrefix = Object.keys(ROLE_GATED_PREFIXES).find((prefix) =>
    matchesPrefix(context.url.pathname, prefix)
  );

  if (gatedPrefix && user) {
    const allowedRoles = ROLE_GATED_PREFIXES[gatedPrefix];

    if (!role || !allowedRoles.includes(role)) {
      if (role && role in ROLE_DASHBOARD) {
        return context.redirect(ROLE_DASHBOARD[role as Exclude<UserRole, "customer">]);
      }
      return context.redirect(role === "customer" ? "/account" : "/");
    }
  }

  return next();
});
