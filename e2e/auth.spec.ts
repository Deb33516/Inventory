import { test, expect } from "@playwright/test";
import { collectConsoleProblems } from "./utils";

// Raw-technical-error phrases that must never reach a user-facing message —
// a crude but effective guard against a Postgres/PostgREST error leaking
// through an Action's error.message unmapped (see actions/index.ts).
const RAW_DB_ERROR_MARKERS = [
  "relation",
  "constraint",
  "syntax error",
  "duplicate key",
  "violates",
  "pg_",
  "23505",
  "23503",
];

function assertNoRawDbError(text: string) {
  const lower = text.toLowerCase();
  for (const marker of RAW_DB_ERROR_MARKERS) {
    expect(lower, `message unexpectedly contained raw DB error marker "${marker}": ${text}`).not.toContain(marker);
  }
}

test("login page renders and rejects bad credentials with a friendly message", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill("nonexistent-user@example.test");
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();

  const message = page.locator("#form-message");
  await expect(message).not.toHaveText("");
  assertNoRawDbError((await message.textContent()) ?? "");

  expect(problems).toEqual([]);
});

test("register page renders with all required fields", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  // Matches the Claude Design canvas's SignUp.dc.html copy — "Your name"
  // and "Work email" label the same real fullName/email fields as before.
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("forgot-password always reports generic success (no account enumeration)", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("definitely-not-a-real-account@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();

  const message = page.locator("#form-message");
  await expect(message).toContainText("If an account exists");
});

test("reset-password without a recovery session shows an invalid-link message, not a form", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  await expect(page.getByLabel("New password")).not.toBeVisible();
});

test("every auth page links back to the homepage", async ({ page }) => {
  // All four auth pages now match their Claude Design canvas artboards
  // exactly — the brand-panel logo link is plain "Inventory", no
  // back-arrow (the arrow was this app's own earlier addition, not part
  // of the supplied design).
  for (const path of ["/login", "/forgot-password", "/reset-password", "/register"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Inventory", exact: true })).toBeVisible();
  }
});

test("forgot-password links back to sign in", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

test("reset-password links back to sign in", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});
