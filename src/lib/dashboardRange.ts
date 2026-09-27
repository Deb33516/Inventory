// Shared date-range resolution for every dashboard (/account, /sales,
// /inventory, /crm, /admin). All dashboard daily bucketing and range math
// is anchored to Asia/Kolkata (fixed UTC+5:30, no DST) so chart "days"
// match the application's expected local calendar day, even though every
// stored timestamp stays UTC. Plain millisecond arithmetic on the
// IST-midnight anchor is safe here specifically because the offset never
// shifts — this would need real IANA-aware arithmetic if the dashboard
// timezone were ever changed to one that observes DST.
//
// `to` is always the EXCLUSIVE start of the day after the last included
// day, matching the [from, to) half-open interval every dashboard RPC
// expects (created_at >= p_from and created_at < p_to) — so the entirety
// of the final selected day is included, never truncated at midnight UTC.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfIstDayAsUtc(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const istMidnightShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(istMidnightShifted - IST_OFFSET_MS);
}

export type DashboardRangePreset = "7d" | "30d" | "90d" | "ytd" | "all";

export interface DashboardRange {
  preset: DashboardRangePreset;
  from: string | null; // inclusive lower bound, ISO UTC instant
  to: string | null; // EXCLUSIVE upper bound, ISO UTC instant
  label: string;
}

export const DASHBOARD_RANGE_PRESETS: { value: DashboardRangePreset; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All time" },
];

const PRESET_LABELS: Record<DashboardRangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
  all: "All time",
};

function isPreset(value: string | null): value is DashboardRangePreset {
  return value === "7d" || value === "30d" || value === "90d" || value === "ytd" || value === "all";
}

export function resolveDashboardRange(rawPreset: string | null, now = new Date()): DashboardRange {
  const preset: DashboardRangePreset = isPreset(rawPreset) ? rawPreset : "30d";

  const todayIstMidnightUtc = startOfIstDayAsUtc(now);
  const exclusiveTo = new Date(todayIstMidnightUtc.getTime() + DAY_MS);

  let from: Date | null;
  switch (preset) {
    case "7d":
      from = new Date(todayIstMidnightUtc.getTime() - 6 * DAY_MS);
      break;
    case "30d":
      from = new Date(todayIstMidnightUtc.getTime() - 29 * DAY_MS);
      break;
    case "90d":
      from = new Date(todayIstMidnightUtc.getTime() - 89 * DAY_MS);
      break;
    case "ytd": {
      const istShifted = new Date(now.getTime() + IST_OFFSET_MS);
      const jan1Shifted = Date.UTC(istShifted.getUTCFullYear(), 0, 1);
      from = new Date(jan1Shifted - IST_OFFSET_MS);
      break;
    }
    case "all":
      from = null;
      break;
  }

  return {
    preset,
    from: from ? from.toISOString() : null,
    to: preset === "all" ? null : exclusiveTo.toISOString(),
    label: PRESET_LABELS[preset],
  };
}

// Rebuilds the current URL with `range` set to a new preset, preserving
// every other existing query param — same convention as the buildUrl
// helpers already used on /sales/orders and /crm/customers.
export function buildDashboardRangeUrl(url: URL, pathname: string, preset: DashboardRangePreset): string {
  const next = new URLSearchParams(url.search);
  next.set("range", preset);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
