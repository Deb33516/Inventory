import { describe, it, expect } from "vitest";
import { ROLE_DASHBOARD, CUSTOMER_ONLY_PREFIXES, ROLE_GATED_PREFIXES } from "./roles";

// This mapping drives two things that must never drift apart: the
// PublicHeader "Go to dashboard" link for a staff/admin role browsing the
// storefront, and middleware.ts's redirect for a non-customer landing on
// /cart or /checkout. There's no real route for a super_admin distinct
// from /admin in this project — confirmed by inspecting src/pages/admin
// and ROLE_GATED_PREFIXES, both of which only ever gate "/admin" to
// ["admin", "super_admin"] together.
describe("ROLE_DASHBOARD", () => {
  it("maps every non-customer role to its actual app section route", () => {
    expect(ROLE_DASHBOARD.sales_staff).toBe("/sales");
    expect(ROLE_DASHBOARD.inventory_staff).toBe("/inventory");
    expect(ROLE_DASHBOARD.admin).toBe("/admin");
    expect(ROLE_DASHBOARD.super_admin).toBe("/admin");
  });

  it("every dashboard route is actually role-gated to that role in ROLE_GATED_PREFIXES", () => {
    for (const [role, href] of Object.entries(ROLE_DASHBOARD)) {
      const allowedRoles = ROLE_GATED_PREFIXES[href];
      expect(allowedRoles, `no role gate found for ${href}`).toBeDefined();
      expect(allowedRoles).toContain(role);
    }
  });
});

describe("CUSTOMER_ONLY_PREFIXES", () => {
  it("covers exactly the customer purchase-flow routes", () => {
    expect(CUSTOMER_ONLY_PREFIXES).toEqual(["/cart", "/checkout"]);
  });
});
