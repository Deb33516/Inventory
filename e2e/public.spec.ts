import { test, expect } from "@playwright/test";
import { collectConsoleProblems } from "./utils";

// Fully anonymous flows — no credentials required, so these always run.

test("homepage renders and is free of console errors", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Matches the Claude Design canvas's Landing artboard — the floating
  // nav's primary CTA is "Sign Up" (design's own copy), not "Create an
  // account". Scope to the header to avoid the strict-mode ambiguity of
  // the hero's matching CTA.
  await expect(page.locator("header").getByRole("link", { name: "Sign Up" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("signed-out homepage shows only signed-out nav — no My account, no Cart, no stale internal-feature cards", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign Up" })).toBeVisible();
  await expect(header.getByRole("link", { name: "My account" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Cart" })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // The old homepage marketed the internal tool itself ("Customers" /
  // "Inventory" / "2 low stock") instead of the real product — this
  // guards against that regressing. The Claude Design Landing artboard has
  // no "Featured products" section at all (that assertion is gone with it
  // — /products remains the real place to browse the catalog).
  await expect(page.getByText("2 low stock")).toHaveCount(0);
});

test("products page lists products and search/filter controls work", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/products");
  // Matches the Claude Design canvas's Customer Shop artboard — the page
  // is now titled "Shop" (design's real screen name), not "Products".
  await expect(page.getByRole("heading", { name: "Shop" })).toBeVisible();

  // Matches the Claude Design canvas's search bar exactly — icon + input,
  // no separate submit button (the design has none); Enter submits the
  // real search form, same as pressing the browser's own go/search key.
  await page.getByPlaceholder("Search by name or SKU…").fill("zzzzznonexistentzzzz");
  await page.getByPlaceholder("Search by name or SKU…").press("Enter");
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
  for (const path of ["/account", "/checkout", "/sales", "/inventory", "/crm", "/admin", "/super"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?redirect=/);
  }
});
