import { describe, it, expect } from "vitest";
import { ROLE_DASHBOARD, CUSTOMER_ONLY_PREFIXES, ROLE_GATED_PREFIXES } from "./roles";

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

  it("super_admin keeps its separate authorization to also visit /admin directly", () => {
    expect(ROLE_GATED_PREFIXES["/admin"]).toEqual(expect.arrayContaining(["admin", "super_admin"]));
  });

  it("/super is gated to super_admin only — admin must not gain access via this route", () => {
    expect(ROLE_GATED_PREFIXES["/super"]).toEqual(["super_admin"]);
  });
});

describe("CUSTOMER_ONLY_PREFIXES", () => {
  it("covers exactly the customer purchase-flow routes", () => {
    expect(CUSTOMER_ONLY_PREFIXES).toEqual(["/cart", "/checkout"]);
  });
});
