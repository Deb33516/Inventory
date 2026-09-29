import type { SidebarNavGroup } from "../components/layout/AppShell.astro";

// Icon path data (SVG `d`) copied verbatim from the Claude Design canvas's
// own icon sets — kept here, not re-derived, for pixel fidelity. `tasks`/
// `sliders`/`search` come from the staff sidebar's own icon set; `alert`/
// `box` come from Staff.dc.html's separate KPI icon set (its "Low stock"
// and "Damage to record" cards use these, not the sidebar's icons).
export const STAFF_ICONS = {
  tasks: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 12l3 3 5-6",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
  search: "M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4",
  support: "M4 4h16v12H8l-4 4z",
  alert: "M12 3 2 20h20zM12 10v4M12 17h.01",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9",
};

// Receiving and Stock adjustments both point at /inventory/stock — the
// design's separate queue pages for each don't exist yet (out of scope,
// per the approved plan); the real actions they'd lead to already live on
// that page, per product. openTicketCount is the caller's real, live count
// of tickets assigned to them that aren't resolved/closed — never a
// fabricated number; the badge is omitted entirely when it's 0.
export function staffSidebarNav(openTicketCount: number): SidebarNavGroup[] {
  return [
    {
      items: [{ label: "Warehouse tasks", href: "/inventory", icon: STAFF_ICONS.tasks }],
    },
    {
      heading: "Inventory",
      items: [
        { label: "Receiving", href: "/inventory/stock", icon: STAFF_ICONS.inbox },
        { label: "Stock adjustments", href: "/inventory/stock", icon: STAFF_ICONS.sliders },
        { label: "Product lookup", href: "/inventory/products", icon: STAFF_ICONS.search },
      ],
    },
    {
      heading: "Help",
      items: [
        {
          label: "Support tickets",
          href: "/inventory/tickets",
          icon: STAFF_ICONS.support,
          badge: openTicketCount > 0 ? String(openTicketCount) : undefined,
        },
      ],
    },
  ];
}
