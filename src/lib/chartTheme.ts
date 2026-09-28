// Shared Chart.js visual theme — DESIGN.md's near-monochrome, restrained
// dashboard language applied once, centrally, instead of every dashboard
// page hand-rolling its own Chart.js options. Only visual configuration
// lives here: no chart data, RPC calls, or date-range logic.
//
// applyChartDefaults() sets Chart.js's own global `Chart.defaults`, which
// every chart instance inherits automatically unless a specific chart's
// own `options` overrides them (none currently need to) — this is the
// idiomatic Chart.js mechanism for shared styling, avoiding per-page
// duplication entirely for fonts/gridlines/legend/tooltip/point/bar
// treatment.

export const CHART_COLORS = {
  ink: "#111111",
  charcoal: "#39393b",
  mute: "#707072",
  stone: "#9e9ea0",
  hairlineStrong: "#cacacb",
  hairline: "#e5e5e5",
  success: "#007d48",
  warning: "#f59e0b",
  error: "#d30005",
} as const;

// A monochrome dark→light ramp for charts distinguishing several
// non-semantic categories (e.g. top products, top spenders) where a flat
// ink fill on every bar would make them indistinguishable from each other.
export const CHART_MONOCHROME_RAMP = [
  CHART_COLORS.ink,
  CHART_COLORS.charcoal,
  CHART_COLORS.mute,
  CHART_COLORS.stone,
  CHART_COLORS.hairlineStrong,
];

// Minimal structural typing for the pieces of Chart.js's global defaults
// object this module touches — avoids depending on chart.js's full types
// here while still catching typos against the properties actually used.
interface ChartDefaultsLike {
  font: { family?: string; size?: number };
  color?: string;
  borderColor?: string;
  plugins: {
    legend: { labels: Record<string, unknown> };
    tooltip: Record<string, unknown>;
  };
  scale: {
    grid: Record<string, unknown>;
    border: Record<string, unknown>;
    ticks: Record<string, unknown>;
  };
  elements: {
    line: Record<string, unknown>;
    point: Record<string, unknown>;
    bar: Record<string, unknown>;
  };
  datasets: {
    bar: Record<string, unknown>;
  };
}

export function applyChartDefaults(defaults: ChartDefaultsLike) {
  defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
  defaults.font.size = 11;
  defaults.color = CHART_COLORS.mute;
  defaults.borderColor = CHART_COLORS.hairline;

  Object.assign(defaults.plugins.legend.labels, {
    boxWidth: 10,
    boxHeight: 10,
    padding: 12,
    font: { size: 11, weight: 500 },
    color: CHART_COLORS.charcoal,
  });

  Object.assign(defaults.plugins.tooltip, {
    backgroundColor: CHART_COLORS.ink,
    titleFont: { size: 12, weight: 600 },
    bodyFont: { size: 12 },
    padding: 10,
    cornerRadius: 2,
    displayColors: false,
  });

  // scale.* applies to every axis (x/y/r) unless a chart overrides one
  // specifically — none currently do.
  Object.assign(defaults.scale.grid, {
    color: CHART_COLORS.hairline,
    tickLength: 0,
  });
  Object.assign(defaults.scale.border, { display: false });
  Object.assign(defaults.scale.ticks, {
    color: CHART_COLORS.mute,
    font: { size: 10 },
  });

  Object.assign(defaults.elements.line, {
    borderWidth: 2,
    tension: 0.3,
  });
  Object.assign(defaults.elements.point, {
    radius: 2,
    hoverRadius: 4,
    backgroundColor: CHART_COLORS.ink,
    borderWidth: 0,
  });
  Object.assign(defaults.elements.bar, {
    borderRadius: 2,
    borderSkipped: false,
  });

  // Restrained bar spacing — caps bar thickness so a chart with only a
  // few categories doesn't render oversized blocks, and tightens the gap
  // between category groups.
  Object.assign(defaults.datasets.bar, {
    maxBarThickness: 40,
    categoryPercentage: 0.6,
    barPercentage: 0.9,
  });
}
