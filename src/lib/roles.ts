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
  { key: "account", label: "Account", href: "/account", roles: ["customer"] },
  { key: "sales", label: "Sales", href: "/sales", roles: ["sales_staff"] },
  { key: "inventory", label: "Inventory", href: "/inventory", roles: ["inventory_staff"] },
  { key: "crm", label: "CRM", href: "/crm", roles: ["sales_staff"] },
  { key: "admin", label: "Admin", href: "/admin", roles: ["admin"] },
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
export const CUSTOMER_ONLY_PREFIXES = ["/account", "/cart", "/checkout"];

// AppShell's sidebar config — deliberately separate from APP_SECTIONS/
// ROLE_GATED_PREFIXES above. APP_SECTIONS' href doubles as the route-gating
// prefix root middleware enforces; this list is purely presentational (which
// link the sidebar shows, and where it points within an already-gated
// section) and must never be used to derive route gating.
export const SIDEBAR_NAV: {
  key: string;
  label: string;
  href: string;
  roles: UserRole[];
}[] = [
  { key: "sales", label: "Sales", href: "/sales/orders", roles: ["sales_staff"] },
  { key: "inventory", label: "Inventory", href: "/inventory/products", roles: ["inventory_staff"] },
  { key: "crm", label: "CRM", href: "/crm/customers", roles: ["sales_staff"] },
  { key: "approvals", label: "Approvals", href: "/admin/approvals", roles: ["admin"] },
  { key: "staff", label: "Staff", href: "/admin/staff", roles: ["admin"] },
];

// Inventory and Sales each have more than one operational sub-page —
// AppShell renders these as a secondary tab row instead of adding new
// routes. Keys match SIDEBAR_NAV's "active" values.
export const SECTION_SUBNAV: Record<string, { label: string; href: string }[]> = {
  inventory: [
    { label: "Products", href: "/inventory/products" },
    { label: "Receiving", href: "/inventory/receiving" },
    { label: "Adjustments", href: "/inventory/adjustments" },
  ],
  sales: [
    { label: "Orders", href: "/sales/orders" },
    { label: "New order", href: "/sales/orders/new" },
  ],
};

/**
 * Validates that a redirect path is strictly internal to the current origin.
 * Prevents open redirects (e.g. //evil.com, https://evil.com, /\evil.com).
 * - Must start with '/'
 * - Must NOT start with '//'
 * - Must NOT contain '\\'
 */
export function isSafeInternalRedirect(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

export function getSafeInternalRedirect(path: string | null | undefined, fallback = "/account"): string {
  return isSafeInternalRedirect(path) ? path! : fallback;
}

export function getRoleDashboard(role: UserRole | null | undefined): string {
  if (!role || role === "customer") return "/account";
  return ROLE_DASHBOARD[role] ?? "/account";
}

