-- Phase 6 fix: customers.notes was reachable by the customer themself via
-- customers_select_own (RLS is row-level, not column-level — the field
-- was never actually protected, only kept off the /account page by query
-- discipline). Moving staff-only note data to its own table with its own
-- RLS is the only way to make "customers must have zero access" a real
-- database-level guarantee instead of an app-layer convention.
--
-- One row per customer (not a log/history) — a direct, more secure
-- replacement for the single customers.notes field, not a new notes/event
-- system. Confirmed live: 0 of 6 customers rows have any notes data today,
-- so customers.notes is dropped in this same migration, no backfill needed.

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.profiles (id) on delete cascade,
  note text not null check (length(trim(both from note)) > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_notes enable row level security;

create trigger set_updated_at before update on public.customer_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS: staff (sales_staff/admin/super_admin) only, and only against a
-- profile whose role is currently 'customer' — every policy re-checks
-- this via the same exists() shape, so a staff member can never create
-- or read a "note" against another staff/admin profile, even if they
-- already know that profile's id. No policy of any kind exists for the
-- customer role, so RLS's default-deny does that enforcement: a customer
-- querying this table gets zero rows and every write is rejected, at the
-- database level.
-- ---------------------------------------------------------------------

create policy "customer_notes_select_staff"
  on public.customer_notes for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and exists (
      select 1 from public.profiles where id = customer_id and role = 'customer'
    )
  );

create policy "customer_notes_insert_staff"
  on public.customer_notes for insert
  to authenticated
  with check (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and created_by = auth.uid()
    and exists (
      select 1 from public.profiles where id = customer_id and role = 'customer'
    )
  );

create policy "customer_notes_update_staff"
  on public.customer_notes for update
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and exists (
      select 1 from public.profiles where id = customer_id and role = 'customer'
    )
  )
  with check (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and exists (
      select 1 from public.profiles where id = customer_id and role = 'customer'
    )
  );

create policy "customer_notes_delete_staff"
  on public.customer_notes for delete
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and exists (
      select 1 from public.profiles where id = customer_id and role = 'customer'
    )
  );

-- ---------------------------------------------------------------------
-- Drop the now-unprotectable column. Safe: verified live that 0 of 6
-- customers rows have any notes data.
-- ---------------------------------------------------------------------

alter table public.customers drop column notes;
