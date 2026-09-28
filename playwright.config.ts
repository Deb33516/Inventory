import { defineConfig, devices } from "@playwright/test";

// Real customer E2E coverage (login, checkout, role-gating) runs only when
// these are set — no staff-account credentials exist for browser login (the
// 4 SQL-created role-test accounts deliberately have no password, see
// CLAUDE.md), so per Phase 10 scope, staff/admin UI stays covered by the
// existing DB/RLS test suite instead of a browser session. Customer tests
// skip themselves gracefully when these aren't provided.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4321",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // `astro preview` doesn't support the @astrojs/vercel adapter's server
  // output ("does not support the preview command"), so E2E runs against
  // the dev server instead — the same local-testing path used throughout
  // this project (see CLAUDE.md's Development section). The compiled
  // production bundle itself is verified separately by inspecting
  // .vercel/output directly, not through this browser suite.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
