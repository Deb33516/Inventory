import { test, expect } from "@playwright/test";
import { collectConsoleProblems, hasCustomerCreds, customerCreds } from "./utils";

// Regression coverage for the Phase 8 bug: `<script define:vars>` combined
// with a static `import` compiles to a non-module inline script, where
// `import` is a SyntaxError. It silently broke login.astro, ProductForm,
// SupplierForm, and checkout/index.astro before being caught by inspecting
// compiled output. This suite catches the same failure mode the way an end
// user would actually experience it: a broken/uncaught console error on
// page load, on every page known to carry a <script> with an import.

const PUBLIC_PAGES_WITH_SCRIPTS = ["/login", "/register", "/forgot-password", "/reset-password", "/products"];

for (const path of PUBLIC_PAGES_WITH_SCRIPTS) {
  test(`no console/page errors on ${path}`, async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
}

test("product detail + cart pages (AddToCartButton, CartSummary scripts) are error-free", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/products");
  const firstProductLink = page.locator('a[href^="/products/"]').first();
  test.skip((await firstProductLink.count()) === 0, "No seeded products available.");
  await firstProductLink.click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.goto("/cart");
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("account dashboard (ChartCanvas/Chart.js) is error-free for a real customer session", async ({ page }) => {
  test.skip(!hasCustomerCreds, "E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD not set — skipping.");

  const problems = collectConsoleProblems(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(customerCreds.email);
  await page.getByLabel("Password").fill(customerCreds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account/);
  await page.waitForLoadState("networkidle");

  expect(problems).toEqual([]);
});
