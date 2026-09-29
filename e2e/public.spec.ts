import { test, expect } from "@playwright/test";
import { collectConsoleProblems } from "./utils";

// Fully anonymous flows — no credentials required, so these always run.

test("homepage renders and is free of console errors", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The header nav and hero both carry a "Create an account" CTA
  // (persistent affordance + primary hero CTA) — scope to the header to
  // avoid the strict-mode ambiguity of two matches.
  await expect(page.locator("header").getByRole("link", { name: "Create an account" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("signed-out homepage shows only signed-out nav — no My account, no Cart, no stale internal-feature cards", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Products" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Create an account" })).toBeVisible();
  await expect(header.getByRole("link", { name: "My account" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Cart" })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // The old homepage marketed the internal tool itself ("Customers" /
  // "Inventory" / "2 low stock") instead of showing real products — this
  // guards against that regressing.
  await expect(page.getByText("2 low stock")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Featured products" })).toBeVisible();
});

test("products page lists products and search/filter controls work", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/products");
  // Matches the Claude Design canvas's Customer Shop artboard — the page
  // is now titled "Shop" (design's real screen name), not "Products".
  await expect(page.getByRole("heading", { name: "Shop" })).toBeVisible();

  await page.getByPlaceholder("Search by name or SKU…").fill("zzzzznonexistentzzzz");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No products found")).toBeVisible();

  expect(problems).toEqual([]);
});

test("visiting a product detail page and adding it to the cart works", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/products");

  const firstProductLink = page.locator('a[href^="/products/"]').first();
  const count = await firstProductLink.count();
  test.skip(count === 0, "No seeded products available to click through.");

  await firstProductLink.click();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();

  // Immediate feedback: "Added to cart" + a clickable "View cart" link,
  // visible long enough to actually use (not a fleeting toast).
  await expect(page.getByText("Added to cart")).toBeVisible();
  const viewCartLink = page.getByRole("link", { name: "View cart" });
  await expect(viewCartLink).toBeVisible();

  await viewCartLink.click();
  await expect(page).toHaveURL(/\/cart$/);
  // Matches the Claude Design canvas's Customer Cart artboard — the page
  // heading is now "Cart" (design's real screen name), not "Your cart".
  await expect(page.getByRole("heading", { name: "Cart", exact: true })).toBeVisible();
  // The cart is localStorage-only — a successfully added item means the
  // page no longer shows the empty-cart state.
  await expect(page.getByText("Your cart is empty")).not.toBeVisible();
  await expect(page.getByText("Subtotal:")).toBeVisible();

  expect(problems).toEqual([]);
});

test("unauthenticated visitor is redirected to login from every protected section", async ({ page }) => {
  for (const path of ["/account", "/checkout", "/sales", "/inventory", "/crm", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?redirect=/);
  }
});
