-- Phase 8: read-only dashboard aggregation functions + one snapshot view.
-- No new tables, no new RLS policies, no changes to any existing table,
-- function, or policy. Every function is SECURITY INVOKER (not DEFINER):
-- none of this needs privilege elevation, because the underlying tables'
-- existing RLS policies already scope visibility correctly for every
-- role, including the customer. A customer calling dashboard_revenue_trend
-- naturally gets only their own orders back (orders_select_own); staff
-- calling the exact same function get store-wide data (orders_select_staff,
-- unscoped). No role branching inside any function here.
--
-- Two conventions applied identically everywhere below:
-- 1. Half-open interval: created_at >= p_from AND created_at < p_to.
--    p_to is always the EXCLUSIVE end of the range (see dashboardRange.ts),
--    so the final selected day is never truncated. A null bound means "no
--    limit on that side" (used by the "all time" range preset).
-- 2. Daily buckets (where a function buckets by day) are keyed by
--    Asia/Kolkata calendar date via `at time zone 'Asia/Kolkata'`, not UTC
--    date, even though created_at is stored in UTC throughout — so a
--    chart's "day" matches what a user in IST actually experienced.

-- ---------------------------------------------------------------------
-- dashboard_revenue_trend: daily revenue + order count, non-cancelled
-- orders only (a cancelled order keeps payments.status = 'paid' by
-- Phase 7's deliberate design, so counting it as revenue would be
-- dishonest — same exclusion customer_metrics.lifetime_spend already
-- uses).
-- ---------------------------------------------------------------------

create or replace function public.dashboard_revenue_trend(p_from timestamptz, p_to timestamptz)
returns table (day date, revenue numeric, order_count bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    (o.created_at at time zone 'Asia/Kolkata')::date as day,
    coalesce(sum(o.total), 0) as revenue,
    count(*) as order_count
  from public.orders o
  where o.status <> 'cancelled'
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at < p_to)
  group by day
  order by day;
$$;

revoke execute on function public.dashboard_revenue_trend(timestamptz, timestamptz) from public;
revoke execute on function public.dashboard_revenue_trend(timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_revenue_trend(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- dashboard_orders_by_status: order count per status in range, every
-- status included (cancelled is its own segment here, not hidden).
-- ---------------------------------------------------------------------

create or replace function public.dashboard_orders_by_status(p_from timestamptz, p_to timestamptz)
returns table (status public.order_status, order_count bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select o.status, count(*) as order_count
  from public.orders o
  where (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at < p_to)
  group by o.status;
$$;

revoke execute on function public.dashboard_orders_by_status(timestamptz, timestamptz) from public;
revoke execute on function public.dashboard_orders_by_status(timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_orders_by_status(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- dashboard_top_products: top products by revenue in range (units_sold
-- returned alongside so the same function serves both the sales
-- dashboard's "top by revenue" chart and the inventory dashboard's
-- "top by units" chart). p_limit clamped to [1, 20].
-- ---------------------------------------------------------------------

create or replace function public.dashboard_top_products(p_from timestamptz, p_to timestamptz, p_limit integer default 5)
returns table (product_id uuid, sku text, name text, units_sold bigint, revenue numeric)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    p.id as product_id,
    p.sku,
    p.name,
    sum(oi.quantity) as units_sold,
    sum(oi.subtotal) as revenue
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.status <> 'cancelled'
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at < p_to)
  group by p.id, p.sku, p.name
  order by revenue desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke execute on function public.dashboard_top_products(timestamptz, timestamptz, integer) from public;
revoke execute on function public.dashboard_top_products(timestamptz, timestamptz, integer) from anon;
grant execute on function public.dashboard_top_products(timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------
-- dashboard_inventory_movement_summary: movement count + total quantity
-- per movement_type in range.
-- ---------------------------------------------------------------------

create or replace function public.dashboard_inventory_movement_summary(p_from timestamptz, p_to timestamptz)
returns table (movement_type public.movement_type, movement_count bigint, total_quantity bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    im.movement_type,
    count(*) as movement_count,
    sum(abs(im.quantity_delta)) as total_quantity
  from public.inventory_movements im
  where (p_from is null or im.created_at >= p_from)
    and (p_to is null or im.created_at < p_to)
  group by im.movement_type;
$$;

revoke execute on function public.dashboard_inventory_movement_summary(timestamptz, timestamptz) from public;
revoke execute on function public.dashboard_inventory_movement_summary(timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_inventory_movement_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- dashboard_customer_growth: new customer signups per day in range.
-- profiles RLS (profiles_select_own) means a customer calling this only
-- ever sees their own signup date as a single row — not useful for that
-- role, but not a leak either, so it's simply not wired into /account.
-- ---------------------------------------------------------------------

create or replace function public.dashboard_customer_growth(p_from timestamptz, p_to timestamptz)
returns table (day date, new_customers bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    (p.created_at at time zone 'Asia/Kolkata')::date as day,
    count(*) as new_customers
  from public.profiles p
  where p.role = 'customer'
    and (p_from is null or p.created_at >= p_from)
    and (p_to is null or p.created_at < p_to)
  group by day
  order by day;
$$;

revoke execute on function public.dashboard_customer_growth(timestamptz, timestamptz) from public;
revoke execute on function public.dashboard_customer_growth(timestamptz, timestamptz) from anon;
grant execute on function public.dashboard_customer_growth(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- inventory_value_summary: current inventory value at retail price
-- (products.price, not products.cost — cost is nullable and not
-- reliably populated). A snapshot, not range-filtered, since stock level
-- is a current-state fact, not a historical trend.
-- ---------------------------------------------------------------------

create or replace view public.inventory_value_summary
with (security_invoker = true)
as
select coalesce(sum(i.quantity_on_hand * p.price), 0) as inventory_value
from public.inventory i
join public.products p on p.id = i.product_id
where p.is_active = true;

-- Views aren't documented as getting the same auto-grant-to-anon default
-- functions get, but explicit revokes are applied anyway rather than
-- assumed unnecessary — same lesson customer_contact_email's anon bug
-- taught in Phase 6.
revoke select on public.inventory_value_summary from public;
revoke select on public.inventory_value_summary from anon;
grant select on public.inventory_value_summary to authenticated;
