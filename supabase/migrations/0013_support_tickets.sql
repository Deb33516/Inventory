-- Minimal support-ticket module, added to back the Inventory Staff
-- "Warehouse tasks" dashboard's Support tickets nav item and "My open
-- tickets" KPI (Claude Design handoff). Scope is intentionally the minimum
-- needed for that one real workflow: customer/staff/admin can create a
-- ticket, inventory_staff sees and updates only tickets assigned to them,
-- admin/super_admin see and manage everything. sales_staff has no access —
-- the Support module isn't part of their role. No customer- or
-- admin-facing UI ships in this phase; this migration lays the real,
-- correctly-scoped data model those can build against later.

create type public.ticket_status as enum (
  'open',
  'in_progress',
  'waiting',
  'resolved',
  'closed'
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid references public.profiles (id) on delete set null,
  subject text not null check (length(trim(both from subject)) > 0),
  description text not null check (length(trim(both from description)) > 0),
  status public.ticket_status not null default 'open',
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_support_tickets_assigned_to on public.support_tickets (assigned_to);
create index idx_support_tickets_created_by on public.support_tickets (created_by);
create index idx_support_tickets_status on public.support_tickets (status);

alter table public.support_tickets enable row level security;

create trigger set_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

-- A customer sees only tickets they created themselves.
create policy "support_tickets_select_own_customer"
  on public.support_tickets for select
  to authenticated
  using (private.current_role() = 'customer' and created_by = auth.uid());

-- inventory_staff sees only tickets currently assigned to them — never the
-- full queue. This is the real enforcement behind "Staff must NOT have
-- global support administration capabilities."
create policy "support_tickets_select_assigned_staff"
  on public.support_tickets for select
  to authenticated
  using (private.current_role() = 'inventory_staff' and assigned_to = auth.uid());

-- admin/super_admin see every ticket (overall workflow management).
create policy "support_tickets_select_admin"
  on public.support_tickets for select
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'));

-- Any of customer/inventory_staff/admin/super_admin may create a ticket for
-- themselves (customer reporting an issue, staff/admin reporting an
-- operational one via "Report an issue"). sales_staff is deliberately
-- excluded — the Support module isn't part of that role.
create policy "support_tickets_insert_own"
  on public.support_tickets for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and private.current_role() in ('customer', 'inventory_staff', 'admin', 'super_admin')
  );

-- inventory_staff may update only a ticket currently assigned to them (adds
-- operational notes/resolution, advances status) — never reassign it or
-- touch anyone else's ticket. The action layer only ever sends
-- status/resolution fields; this row-level scope is the real backstop.
create policy "support_tickets_update_assigned_staff"
  on public.support_tickets for update
  to authenticated
  using (private.current_role() = 'inventory_staff' and assigned_to = auth.uid())
  with check (private.current_role() = 'inventory_staff' and assigned_to = auth.uid());

-- admin/super_admin manage the overall workflow: assign, reassign, close.
create policy "support_tickets_update_admin"
  on public.support_tickets for update
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'))
  with check (private.current_role() in ('admin', 'super_admin'));
