import type { UserRole } from "./types";

// Single source of truth for section access control, shared by
// src/middleware.ts (enforcement) and AppHeader.astro (nav visibility) so
// the two can never drift apart. Order here also drives nav item order.
export const APP_SECTIONS: {
  key: string;
  label: string;
  href: string;
  roles: UserRole[] | "any";
}[] = [
  { key: "account", label: "Account", href: "/account", roles: "any" },
  { key: "sales", label: "Sales", href: "/sales", roles: ["sales_staff", "admin", "super_admin"] },
  { key: "inventory", label: "Inventory", href: "/inventory", roles: ["inventory_staff", "admin", "super_admin"] },
  { key: "crm", label: "CRM", href: "/crm", roles: ["sales_staff", "admin", "super_admin"] },
  { key: "admin", label: "Admin", href: "/admin", roles: ["admin", "super_admin"] },
  // Super Admin's own application area — deliberately NOT ["admin",
  // "super_admin"] like /admin above: super_admin is still separately
  // authorized to visit /admin (that grant is untouched), but /super
  // itself is super_admin-only. admin must never gain /super access.
  // No pages exist under /super yet (routing/shell foundation only, see
  // NavSidebar.astro's SUPER_NAV) — middleware.ts's PROTECTED_PREFIXES
  // still needs its own separate "/super" entry for the unauthenticated
  // case, since that array isn't derived from this one.
  { key: "super", label: "Super Admin", href: "/super", roles: ["super_admin"] },
];

// Derived from APP_SECTIONS so middleware's role gate can't drift from the
// nav's visibility rules above.
export const ROLE_GATED_PREFIXES: Record<string, UserRole[]> = Object.fromEntries(
  APP_SECTIONS.filter((s) => s.roles !== "any").map((s) => [s.href, s.roles as UserRole[]])
);

// Where a staff/admin role's own "home" lives — used by PublicHeader's
// "Go to dashboard" link (for a staff member who ends up on a customer
// page), by middleware's customer-only route guard below, and by
// actions/index.ts's signIn action to compute the post-login redirect.
// admin -> /admin, super_admin -> /super: two genuinely separate
// application areas as of this turn (previously both pointed at /admin —
// that was the root cause of super_admin rendering the Admin shell/badge
// post-login; see the routing/shell-separation audit). super_admin keeps
// its existing, unrelated authorization to also visit /admin directly
// (ROLE_GATED_PREFIXES["/admin"] still includes it) — this map only
// decides where a bare "go to your dashboard" action lands, not who may
// access what.
export const ROLE_DASHBOARD: Record<Exclude<UserRole, "customer">, string> = {
  sales_staff: "/sales",
  inventory_staff: "/inventory",
  admin: "/admin",
  super_admin: "/super",
};

// Routes that are part of the customer purchase flow only. A staff/admin
// role that manually navigates here shouldn't see an irrelevant/empty
// customer cart or checkout — middleware redirects them to their own
// dashboard instead (see ROLE_DASHBOARD). Anonymous visitors and the
// `customer` role are unaffected; /cart specifically stays intentionally
// browsable while signed out (see middleware.ts).
export const CUSTOMER_ONLY_PREFIXES = ["/cart", "/checkout"];

// AppShell's sidebar config — deliberately separate from APP_SECTIONS/
// ROLE_GATED_PREFIXES above. APP_SECTIONS' href doubles as the route-gating
// prefix root middleware enforces; this list is purely presentational (which
// link the sidebar shows, and where it points within an already-gated
// section) and must never be used to derive route gating. Every href below
// already falls inside an existing gated prefix from APP_SECTIONS: /sales/*
// and /inventory/* and /crm/* are covered by their own section's gate,
// /admin/approvals and /admin/staff are both covered by the existing
// prefix-match on "/admin" (no separate gate needed for either). "Dashboard"
// reuses ROLE_DASHBOARD directly rather than a hardcoded href, so it always
// matches the login-redirect destination for that role by construction.
export const SIDEBAR_NAV: {
  key: string;
  label: string;
  href: string;
  roles: UserRole[];
}[] = [
  { key: "sales", label: "Sales", href: "/sales/orders", roles: ["sales_staff", "admin", "super_admin"] },
  { key: "inventory", label: "Inventory", href: "/inventory/stock", roles: ["inventory_staff", "admin", "super_admin"] },
  { key: "crm", label: "CRM", href: "/crm/customers", roles: ["sales_staff", "admin", "super_admin"] },
  { key: "approvals", label: "Approvals", href: "/admin/approvals", roles: ["admin", "super_admin"] },
  { key: "staff", label: "Staff", href: "/admin/staff", roles: ["admin", "super_admin"] },
];

// Inventory and Sales each have more than one operational sub-page —
// AppShell renders these as a secondary tab row instead of adding new
// routes. Keys match SIDEBAR_NAV's "active" values.
export const SECTION_SUBNAV: Record<string, { label: string; href: string }[]> = {
  inventory: [
    { label: "Stock", href: "/inventory/stock" },
    { label: "Movements", href: "/inventory/movements" },
    { label: "Suppliers", href: "/inventory/suppliers" },
    { label: "Products", href: "/inventory/products" },
    { label: "Categories", href: "/inventory/categories" },
  ],
  sales: [
    { label: "Orders", href: "/sales/orders" },
    { label: "New order", href: "/sales/orders/new" },
  ],
};
