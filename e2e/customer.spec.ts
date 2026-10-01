import { test, expect } from "@playwright/test";
import { collectConsoleProblems, hasCustomerCreds, customerCreds } from "./utils";

// These tests require a REAL customer account's credentials, provided via
// E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD env vars — per the approved
// Phase 10 scope, no new auth infrastructure was introduced to make the
// SQL-created staff/admin test accounts browser-login capable, so staff/
// admin UI stays covered by the existing DB/RLS test suite instead (see
// CLAUDE.md). These tests skip themselves when the env vars are absent.
//
// Deliberately does NOT submit a real order at checkout — that would
// permanently write a real order/payment/inventory-movement row against
// the live Supabase project through this real account, with no rollback
// path (unlike the transaction-based DB testing used in every prior
// phase). Order placement itself stays verified through that existing,
// reversible method; this suite only confirms the checkout page itself
// renders and is reachable.

test.beforeEach(() => {
  test.skip(!hasCustomerCreds, "E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD not set — skipping real-account tests.");
});

async function loginAsCustomer(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(customerCreds.email);
  await page.getByLabel("Password").fill(customerCreds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account/);
}

test("customer can log in and see their account dashboard", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await loginAsCustomer(page);
  // /account is the Claude Design canvas's Customer portal artboard — a
  // lean dashboard overview now, not the full profile page (moved to
  // /account/profile, see below).
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  // /account renders ChartCanvas (Chart.js) — the exact component class
  // that carried the Phase 8 define:vars/import regression.
  expect(problems).toEqual([]);
});

test("customer role is blocked from every staff/admin section", async ({ page }) => {
  await loginAsCustomer(page);
  for (const path of ["/inventory", "/sales", "/crm", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/");
  }
});

test("customer can reach checkout with items in cart (order is not submitted)", async ({ page }) => {
  await loginAsCustomer(page);

  await page.goto("/products");
  const firstProductLink = page.locator('a[href^="/products/"]').first();
  test.skip((await firstProductLink.count()) === 0, "No seeded products available.");
  await firstProductLink.click();
  await page.getByRole("button", { name: "Add to cart" }).click();

  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.getByLabel("Shipping address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order" })).toBeVisible();
  // Intentionally not clicked — see file header.
});

test("customer can sign out", async ({ page }) => {
  await loginAsCustomer(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
});

test("signed-in customer sees the customer header everywhere, not the signed-out or staff state", async ({
  page,
}) => {
  await loginAsCustomer(page);

  // "/" excluded here: the Claude Design canvas's Landing artboard is a
  // distinct pre-auth marketing nav (Log in/Sign Up only, no Cart/avatar/
  // Sign out) — it never carried the storefront's PublicHeader, even
  // before this pass, and the design itself doesn't have an authenticated
  // state for this screen. A signed-in visitor still gets a real "My
  // account" link there instead of "Log in"/"Sign Up" (see the landing
  // page's own dedicated test below).
  //
  // "/account" also excluded from this specific loop: it now renders the
  // Claude Design canvas's own NavCustomer (project/NavCustomer.dc.html),
  // not PublicHeader — same real Cart/My profile links, but genuinely no
  // Sign out control there (the design has none; that action lives on
  // /account/profile, same as it already did before this pass). Covered
  // by its own test below instead of this shared PublicHeader assertion.
  await page.goto("/products");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Cart" })).toBeVisible();
  // "My account" is now an avatar link (initials, no literal "My
  // account" text) matching the Claude Design canvas's NavCustomer.
  await expect(header.getByRole("link", { name: "My profile" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
});

test("signed-in customer sees a real 'My account' link on the landing page's own nav", async ({ page }) => {
  await loginAsCustomer(page);
  await page.goto("/");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "My account" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Sign Up" })).toHaveCount(0);
});

test("Customer Portal (/account) shows the real NavCustomer chrome — Home/Shop/My orders/Support tabs, Cart, My profile", async ({
  page,
}) => {
  await loginAsCustomer(page);
  await page.goto("/account");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Shop", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "My orders" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Support", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Cart" })).toBeVisible();
  await expect(header.getByRole("link", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
});

test("cart badge updates immediately after Add to cart and persists across pages", async ({ page }) => {
  await loginAsCustomer(page);

  const badge = page.locator("#cart-count-badge");
  await page.goto("/products");
  // Badge starts hidden (or absent from an empty cart) before any add.
  if (await badge.count()) {
    await expect(badge).toBeHidden();
  }

  const firstProductLink = page.locator('a[href^="/products/"]').first();
  test.skip((await firstProductLink.count()) === 0, "No seeded products available.");
  await firstProductLink.click();
  await page.getByRole("button", { name: "Add to cart" }).click();

  await expect(page.locator("#cart-count-badge")).toBeVisible();
  await expect(page.locator("#cart-count-badge")).not.toHaveText("0");

  // Navigating to a different page re-renders PublicHeader server-side —
  // the badge must still reflect the (client-persisted) cart on load.
  await page.goto("/account");
  await expect(page.locator("#cart-count-badge")).toBeVisible();
  await expect(page.locator("#cart-count-badge")).not.toHaveText("0");
});

test("account profile: Edit shows inputs, Cancel discards changes and reverts to display", async ({ page }) => {
  await loginAsCustomer(page);
  // Profile editing moved to its own route, matching the Claude Design
  // canvas's separate Profile screen — no longer bundled into /account.
  await page.goto("/account/profile");

  const originalPhone = (await page.locator('[data-field="phone"]').textContent())?.trim() ?? "";

  await page.getByRole("button", { name: "Edit profile" }).click();
  const phoneInput = page.getByLabel("Phone (optional)");
  await expect(phoneInput).toBeVisible();
  await phoneInput.fill("0000000000-should-not-save");

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(phoneInput).toBeHidden();
  await expect(page.locator('[data-field="phone"]')).toHaveText(originalPhone);
});

test("account profile: Edit, Save shows a non-blocking confirmation and returns to display", async ({ page }) => {
  await loginAsCustomer(page);
  await page.goto("/account/profile");

  const uniquePhone = `+1-555-${Date.now().toString().slice(-7)}`;

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Phone (optional)").fill(uniquePhone);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Profile updated")).toBeVisible();
  await expect(page.getByLabel("Phone (optional)")).toBeHidden();
  await expect(page.locator('[data-field="phone"]')).toHaveText(uniquePhone);

  // Confirms the save actually persisted server-side, not just in the DOM.
  await page.reload();
  await expect(page.locator('[data-field="phone"]')).toHaveText(uniquePhone);
});
