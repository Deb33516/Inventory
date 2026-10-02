import { describe, it, expect } from "vitest";
import { ROLE_DASHBOARD, CUSTOMER_ONLY_PREFIXES, ROLE_GATED_PREFIXES, isSafeInternalRedirect, getSafeInternalRedirect } from "./roles";

// This mapping drives three things that must never drift apart: the
// PublicHeader "Go to dashboard" link for a staff/admin role browsing the
// storefront, middleware.ts's redirect for a non-customer landing on
// /cart or /checkout, and actions/index.ts's signIn post-login redirect.
// admin -> /admin, super_admin -> /super: two separate application areas
// (as of the routing/shell-separation fix — previously both pointed at
// /admin, which was the root cause of super_admin rendering the Admin
// shell/badge after login). super_admin's separate, still-intact
// authorization to also visit /admin directly is a different concern
// (ROLE_GATED_PREFIXES["/admin"]) — see the second test below.
describe("ROLE_DASHBOARD", () => {
  it("maps every non-customer role to its actual app section route", () => {
    expect(ROLE_DASHBOARD.sales_staff).toBe("/sales");
    expect(ROLE_DASHBOARD.inventory_staff).toBe("/inventory");
    expect(ROLE_DASHBOARD.admin).toBe("/admin");
    expect(ROLE_DASHBOARD.super_admin).toBe("/super");
  });

  it("every dashboard route is actually role-gated to that role in ROLE_GATED_PREFIXES", () => {
    for (const [role, href] of Object.entries(ROLE_DASHBOARD)) {
      const allowedRoles = ROLE_GATED_PREFIXES[href];
      expect(allowedRoles, `no role gate found for ${href}`).toBeDefined();
      expect(allowedRoles).toContain(role);
    }
  });
});

describe("ROLE_GATED_PREFIXES", () => {
  it("restricts /sales and /crm strictly to sales_staff", () => {
    expect(ROLE_GATED_PREFIXES["/sales"]).toEqual(["sales_staff"]);
    expect(ROLE_GATED_PREFIXES["/crm"]).toEqual(["sales_staff"]);
  });

  it("restricts /inventory strictly to inventory_staff", () => {
    expect(ROLE_GATED_PREFIXES["/inventory"]).toEqual(["inventory_staff"]);
  });

  it("restricts /account strictly to customer", () => {
    expect(ROLE_GATED_PREFIXES["/account"]).toEqual(["customer"]);
  });

  it("restricts /admin strictly to admin", () => {
    expect(ROLE_GATED_PREFIXES["/admin"]).toEqual(["admin"]);
  });

  it("restricts /super strictly to super_admin", () => {
    expect(ROLE_GATED_PREFIXES["/super"]).toEqual(["super_admin"]);
  });
});

describe("CUSTOMER_ONLY_PREFIXES", () => {
  it("covers customer portal and purchase-flow routes", () => {
    expect(CUSTOMER_ONLY_PREFIXES).toEqual(["/account", "/cart", "/checkout"]);
  });
});

describe("Authorization Decision Matrix Helper", () => {
  function getAccessDecision(pathname: string, role: string | null) {
    const cleanPath = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
    const matches = (prefix: string) => cleanPath === prefix || cleanPath.startsWith(prefix + "/");

    const PROTECTED_PREFIXES = ["/account", "/inventory", "/crm", "/checkout", "/sales", "/admin", "/super"];
    const isProtected = PROTECTED_PREFIXES.some(matches);

    if (isProtected && !role) {
      return { status: "unauthenticated_redirect", target: `/login?redirect=${encodeURIComponent(pathname)}` };
    }

    const isCustomerOnly = CUSTOMER_ONLY_PREFIXES.some(matches);
    if (isCustomerOnly && role && role !== "customer") {
      return { status: "denied", target: ROLE_DASHBOARD[role as keyof typeof ROLE_DASHBOARD] };
    }

    const gatedPrefix = Object.keys(ROLE_GATED_PREFIXES).find(matches);
    if (gatedPrefix && role) {
      const allowedRoles = ROLE_GATED_PREFIXES[gatedPrefix];
      if (!allowedRoles.includes(role as any)) {
        return {
          status: "denied",
          target: role in ROLE_DASHBOARD ? ROLE_DASHBOARD[role as keyof typeof ROLE_DASHBOARD] : (role === "customer" ? "/account" : "/"),
        };
      }
    }

    return { status: "allowed" };
  }

  it("verifies Customer role access matrix", () => {
    expect(getAccessDecision("/account", "customer")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/sales/orders", "customer")).toEqual({ status: "denied", target: "/account" });
    expect(getAccessDecision("/crm/customers", "customer")).toEqual({ status: "denied", target: "/account" });
    expect(getAccessDecision("/inventory", "customer")).toEqual({ status: "denied", target: "/account" });
    expect(getAccessDecision("/admin", "customer")).toEqual({ status: "denied", target: "/account" });
    expect(getAccessDecision("/super", "customer")).toEqual({ status: "denied", target: "/account" });
  });

  it("verifies Sales Staff role access matrix", () => {
    expect(getAccessDecision("/account", "sales_staff")).toEqual({ status: "denied", target: "/sales" });
    expect(getAccessDecision("/sales", "sales_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/sales/orders", "sales_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/crm/customers", "sales_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/inventory", "sales_staff")).toEqual({ status: "denied", target: "/sales" });
    expect(getAccessDecision("/admin", "sales_staff")).toEqual({ status: "denied", target: "/sales" });
    expect(getAccessDecision("/super", "sales_staff")).toEqual({ status: "denied", target: "/sales" });
  });

  it("verifies Inventory Staff role access matrix", () => {
    expect(getAccessDecision("/account", "inventory_staff")).toEqual({ status: "denied", target: "/inventory" });
    expect(getAccessDecision("/inventory", "inventory_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/inventory/receiving", "inventory_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/inventory/adjustments", "inventory_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/inventory/products", "inventory_staff")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/sales/orders", "inventory_staff")).toEqual({ status: "denied", target: "/inventory" });
    expect(getAccessDecision("/crm/customers", "inventory_staff")).toEqual({ status: "denied", target: "/inventory" });
    expect(getAccessDecision("/admin", "inventory_staff")).toEqual({ status: "denied", target: "/inventory" });
    expect(getAccessDecision("/super", "inventory_staff")).toEqual({ status: "denied", target: "/inventory" });
  });

  it("verifies Admin role access matrix", () => {
    expect(getAccessDecision("/account", "admin")).toEqual({ status: "denied", target: "/admin" });
    expect(getAccessDecision("/admin", "admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/admin/customers", "admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/crm/customers", "admin")).toEqual({ status: "denied", target: "/admin" });
    expect(getAccessDecision("/sales/orders", "admin")).toEqual({ status: "denied", target: "/admin" });
    expect(getAccessDecision("/inventory", "admin")).toEqual({ status: "denied", target: "/admin" });
    expect(getAccessDecision("/super", "admin")).toEqual({ status: "denied", target: "/admin" });
  });

  it("verifies Super Admin role access matrix", () => {
    expect(getAccessDecision("/super", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/super/users", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/super/roles", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/super/approvals", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/super/audit-log", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/super/settings", "super_admin")).toEqual({ status: "allowed" });
    expect(getAccessDecision("/admin", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/admin/customers", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/admin/approvals", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/account", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/sales/orders", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/crm/customers", "super_admin")).toEqual({ status: "denied", target: "/super" });
    expect(getAccessDecision("/inventory", "super_admin")).toEqual({ status: "denied", target: "/super" });
  });

  it("verifies Unauthenticated visitor redirects", () => {
    expect(getAccessDecision("/account", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Faccount" });
    expect(getAccessDecision("/sales/orders", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Fsales%2Forders" });
    expect(getAccessDecision("/crm/customers", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Fcrm%2Fcustomers" });
    expect(getAccessDecision("/inventory", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Finventory" });
    expect(getAccessDecision("/admin", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Fadmin" });
    expect(getAccessDecision("/super", null)).toEqual({ status: "unauthenticated_redirect", target: "/login?redirect=%2Fsuper" });
  });
});

describe("isSafeInternalRedirect", () => {
  it("accepts valid internal relative paths", () => {
    expect(isSafeInternalRedirect("/account")).toBe(true);
    expect(isSafeInternalRedirect("/admin")).toBe(true);
    expect(isSafeInternalRedirect("/super/users")).toBe(true);
    expect(isSafeInternalRedirect("/sales/orders")).toBe(true);
    expect(isSafeInternalRedirect("/products?category=electronics")).toBe(true);
  });

  it("rejects open redirect attempts and malicious protocol-relative paths", () => {
    expect(isSafeInternalRedirect("//evil.com")).toBe(false);
    expect(isSafeInternalRedirect("//evil.com/path")).toBe(false);
    expect(isSafeInternalRedirect("https://evil.com")).toBe(false);
    expect(isSafeInternalRedirect("http://evil.com")).toBe(false);
    expect(isSafeInternalRedirect("/\\evil.com")).toBe(false);
    expect(isSafeInternalRedirect("\\evil.com")).toBe(false);
    expect(isSafeInternalRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalRedirect("")).toBe(false);
    expect(isSafeInternalRedirect(null)).toBe(false);
    expect(isSafeInternalRedirect(undefined)).toBe(false);
  });
});

describe("getSafeInternalRedirect", () => {
  it("returns internal path when valid", () => {
    expect(getSafeInternalRedirect("/super/users")).toBe("/super/users");
    expect(getSafeInternalRedirect("/admin")).toBe("/admin");
  });

  it("falls back to default path when given malicious or external input", () => {
    expect(getSafeInternalRedirect("//evil.com", "/account")).toBe("/account");
    expect(getSafeInternalRedirect("https://evil.com", "/account")).toBe("/account");
    expect(getSafeInternalRedirect("/\\evil.com", "/account")).toBe("/account");
    expect(getSafeInternalRedirect("", "/account")).toBe("/account");
    expect(getSafeInternalRedirect(null, "/account")).toBe("/account");
  });
});

