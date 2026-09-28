import type { Page } from "@playwright/test";

// Collects browser console errors and uncaught page exceptions for a page,
// so a test can assert none occurred — this is exactly the failure mode the
// Phase 8 `define:vars` + `import` bug produced (a SyntaxError thrown when
// the browser tried to run a broken inline script).
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Chrome logs any non-2xx fetch/XHR response as a console.error by
    // itself — e.g. the expected 401 from a deliberately-wrong login
    // attempt. That's a normal API response, not a broken script, so it
    // isn't the failure mode this helper exists to catch (see file header).
    if (/Failed to load resource: the server responded with a status of/.test(msg.text())) return;
    problems.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    problems.push(`pageerror: ${err.message}`);
  });

  return problems;
}

export const hasCustomerCreds = Boolean(
  process.env.E2E_CUSTOMER_EMAIL && process.env.E2E_CUSTOMER_PASSWORD
);

export const customerCreds = {
  email: process.env.E2E_CUSTOMER_EMAIL ?? "",
  password: process.env.E2E_CUSTOMER_PASSWORD ?? "",
};
