-- Admin Settings (real MVP pass): business profile / numbering / stock
-- rules / notifications. Applied live via the Supabase MCP tool first
-- (same "iterate via execute_sql, then commit the finished migration"
-- workflow 0014 used), verified with begin/rollback role-impersonation
-- before being written here.
--
-- ---------------------------------------------------------------------
-- app_settings: a deliberate SINGLETON (id boolean primary key default
-- true check (id) — only the value `true` can ever exist as a primary
-- key, so a second row is structurally impossible). One row, seeded
-- below, never inserted or deleted by the app — only ever updated.
-- Chosen over "scattered unrelated tables" per the explicit instruction
-- to prefer a single business/application settings record.
--
-- Column-by-column real scope (nothing here is a demo/placeholder
-- value — every default reflects this app's actual existing hardcoded
-- behavior, not a fabricated example):
--   business_name, gstin       — genuinely unset (null) until an admin
--                                 saves real values; nothing in this
--                                 project has ever had a real value for
--                                 either.
--   currency                   — defaults 'INR' because every
--                                 formatCurrency() call in this app
--                                 already hardcodes INR store-wide; the
--                                 default documents current real
--                                 behavior, it doesn't invent one.
--   timezone                   — defaults 'Asia/Kolkata' for the same
--                                 reason (dashboardRange.ts already
--                                 hardcodes IST everywhere). The Admin
--                                 Settings UI renders both of these as
--                                 real, honest READ-ONLY fields (not
--                                 editable) — saving a different value
--                                 here would persist genuinely, but
--                                 would have zero effect anywhere else
--                                 in the app (nothing reads this column
--                                 to drive formatting/bucketing), so
--                                 offering them as editable would be the
--                                 "appears functional but doesn't
--                                 persist to anything real" trap the
--                                 task explicitly warned against —
--                                 following the design's own precedent,
--                                 which already renders Currency as
--                                 read-only for the admin role.
--   order_number_prefix,
--   next_order_number          — genuinely real, editable, persisted.
--                                 Explicitly NOT wired into
--                                 place_order()/order id generation —
--                                 orders.id stays a plain uuid exactly as
--                                 before on every screen (Sales/Admin
--                                 Orders, Order Detail, Customer Orders).
--                                 Wiring a human-readable order number
--                                 into the real order-creation path would
--                                 touch every one of those already-
--                                 approved screens, which is out of
--                                 scope this turn — the Admin Settings UI
--                                 says so explicitly rather than
--                                 implying it already works.
--   low_stock_alerts_enabled   — genuinely real and wired to a real
--                                 effect (see notify_low_stock() below),
--                                 defaults false so no notifications
--                                 fire until an admin deliberately turns
--                                 it on.
-- No logo_url column: Supabase Storage is deliberately unimplemented
-- project-wide (CLAUDE.md: "Supabase Storage for product images → later,
-- once catalog UI is proven out" — not even product images use it yet),
-- so "only if it can be implemented cleanly with the existing Storage
-- setup" is not met. No logo upload was built.
-- No allow_negative_stock column: the real `quantity_on_hand >= 0` check
-- constraint on `inventory` (0005_inventory.sql) has no safe per-setting
-- override path without touching record_inventory_movement() and
-- private.apply_order_stock_movement() — both used by every existing
-- order/stock screen. Chose option B from the task's own explicit
-- fallback (render honestly unavailable) rather than loosening a hard
-- data-integrity constraint as a side effect of a Settings-page turn.
-- ---------------------------------------------------------------------

create table public.app_settings (
  id boolean primary key default true check (id),
  business_name text,
  gstin text,
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  order_number_prefix text,
  next_order_number integer not null default 1 check (next_order_number > 0),
  low_stock_alerts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create trigger set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (id) values (true);

-- Admin and super_admin only — "other roles must not gain settings
-- access" (verified live: 0 rows visible to sales_staff).
create policy "app_settings_select_staff"
  on public.app_settings for select
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'));

create policy "app_settings_update_staff"
  on public.app_settings for update
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'))
  with check (private.current_role() in ('admin', 'super_admin'));

-- No insert/delete policy for anyone — the singleton is seeded once
-- above and only ever updated thereafter.

-- ---------------------------------------------------------------------
-- notifications: minimal per-recipient inbox, exactly the fields the
-- task asked for (id, recipient_id, title, message, created_at,
-- read_at, ignored_at) and nothing more — no category, no delivery
-- channel, no push/email/SMS/scheduling columns (explicitly out of
-- MVP scope).
-- ---------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  ignored_at timestamptz
);

create index idx_notifications_recipient on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

-- A recipient sees and can update only their own notifications (verified
-- live: a second admin's notification is invisible and unaffected by a
-- cross-user update attempt). No insert/delete policy for any role —
-- the only real writer is the security-definer trigger below; nothing
-- else in the app should ever fabricate a notification row.
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
-- private.notify_low_stock(): the one real mechanism behind the Stock
-- Rules "Low-stock alerts" toggle. Security definer (same pattern as
-- current_role()/handle_new_user()) because it must insert a
-- notification for every real admin/super_admin profile, not just the
-- staff member whose inventory update happened to fire it — that staff
-- member has no direct RLS grant to write another user's notifications
-- row. Never directly callable (lives in `private`, execute revoked from
-- public/anon, no grant to authenticated) — fires only via the trigger.
--
-- Fires only on the real crossing INTO low stock (new qty <= new reorder
-- level, and the old state was NOT already low) — verified live that a
-- second update while still low does not spam a second notification.
-- Fires only while app_settings.low_stock_alerts_enabled is true —
-- verified live that it's a no-op while the setting is off (its default).
-- ---------------------------------------------------------------------

create or replace function private.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_enabled boolean;
  v_product_name text;
  v_recipient record;
begin
  select low_stock_alerts_enabled into v_enabled from public.app_settings where id = true;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  if new.quantity_on_hand > new.reorder_level or old.quantity_on_hand <= old.reorder_level then
    return new;
  end if;

  select name into v_product_name from public.products where id = new.product_id;

  for v_recipient in select id from public.profiles where role in ('admin', 'super_admin')
  loop
    insert into public.notifications (recipient_id, title, message)
    values (
      v_recipient.id,
      'Low stock: ' || coalesce(v_product_name, 'a product'),
      coalesce(v_product_name, 'A product') || ' is at or below its reorder level (' ||
        new.quantity_on_hand || ' on hand, reorder at ' || new.reorder_level || ').'
    );
  end loop;

  return new;
end;
$$;

revoke execute on function private.notify_low_stock() from public;
revoke execute on function private.notify_low_stock() from anon;

create trigger trg_notify_low_stock
  after update on public.inventory
  for each row
  execute function private.notify_low_stock();
