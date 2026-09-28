import { describe, it, expect } from "vitest";
import { resolveDashboardRange } from "./dashboardRange";

// Regression coverage for the IST-anchored, half-open interval convention
// established in Phase 8 and manually verified once at the time — this
// pins that behavior so a future change can't silently break it.

describe("resolveDashboardRange", () => {
  it("defaults to 30d for a null or unrecognized preset", () => {
    expect(resolveDashboardRange(null).preset).toBe("30d");
    expect(resolveDashboardRange("bogus").preset).toBe("30d");
  });

  it("produces a half-open interval where `to` is the exclusive start of the day after `now`'s IST day", () => {
    // 2026-03-15T10:00:00Z is 2026-03-15T15:30:00+05:30 IST — squarely
    // inside IST day 2026-03-15.
    const now = new Date("2026-03-15T10:00:00.000Z");
    const range = resolveDashboardRange("7d", now);

    // IST midnight for 2026-03-15 is 2026-03-14T18:30:00Z; the exclusive
    // upper bound is one day after that.
    expect(range.to).toBe("2026-03-15T18:30:00.000Z");
    // 7d spans today + 6 prior days.
    expect(range.from).toBe("2026-03-08T18:30:00.000Z");
  });

  it("handles the exact IST-midnight boundary instant without shifting to the previous day", () => {
    // This instant IS IST midnight for 2026-03-15 (2026-03-15T00:00:00+05:30).
    const now = new Date("2026-03-14T18:30:00.000Z");
    const range = resolveDashboardRange("7d", now);

    expect(range.to).toBe("2026-03-15T18:30:00.000Z");
    expect(range.from).toBe("2026-03-08T18:30:00.000Z");
  });

  it("does not truncate the last moment of the day before the boundary", () => {
    // One millisecond before IST midnight for 2026-03-15 — still IST day 2026-03-14.
    const now = new Date("2026-03-14T18:29:59.999Z");
    const range = resolveDashboardRange("7d", now);

    expect(range.to).toBe("2026-03-14T18:30:00.000Z");
  });

  it("30d and 90d span the expected number of days", () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    expect(resolveDashboardRange("30d", now).from).toBe("2026-02-13T18:30:00.000Z");
    expect(resolveDashboardRange("90d", now).from).toBe("2025-12-15T18:30:00.000Z");
  });

  it("ytd anchors `from` to January 1st IST midnight of the current IST year", () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const range = resolveDashboardRange("ytd", now);
    // 2026-01-01T00:00:00+05:30 IST = 2025-12-31T18:30:00Z.
    expect(range.from).toBe("2025-12-31T18:30:00.000Z");
  });

  it("all time has no lower or upper bound", () => {
    const range = resolveDashboardRange("all", new Date("2026-03-15T10:00:00.000Z"));
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
  });
});
