-- Phase 3: suppliers, inventory (how much stock exists), and the
-- append-only inventory_movements ledger. Runs after orders_payments so
-- the FK from inventory_movements to orders resolves.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;

create table public.inventory (
  product_id uuid primary key references public.products (id) on delete cascade,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  updated_at timestamptz not null default now()
);

-- Cheap index-only lookup for the low-stock dashboard widget.
create index idx_inventory_low_stock on public.inventory (product_id)
  where quantity_on_hand <= reorder_level;

alter table public.inventory enable row level security;

create trigger set_updated_at before update on public.inventory
  for each row execute function public.set_updated_at();

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  movement_type public.movement_type not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text,
  supplier_id uuid references public.suppliers (id) on delete set null,
  reference_order_id uuid references public.orders (id) on delete set null,
  performed_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_product_created
  on public.inventory_movements (product_id, created_at desc);

alter table public.inventory_movements enable row level security;

-- ---------------------------------------------------------------------
-- RLS: suppliers
-- ---------------------------------------------------------------------

create policy "suppliers_all_inventory_staff"
  on public.suppliers for all
  to authenticated
  using (private.current_role() in ('inventory_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

-- ---------------------------------------------------------------------
-- RLS: inventory
-- ---------------------------------------------------------------------

create policy "inventory_select_staff"
  on public.inventory for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'inventory_staff', 'admin', 'super_admin')
  );

create policy "inventory_insert_staff"
  on public.inventory for insert
  to authenticated
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

create policy "inventory_update_staff"
  on public.inventory for update
  to authenticated
  using (private.current_role() in ('inventory_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

-- ---------------------------------------------------------------------
-- RLS: inventory_movements (append-only — deliberately no update/delete
-- policy for any role; that omission is the enforcement)
-- ---------------------------------------------------------------------

create policy "inventory_movements_select_staff"
  on public.inventory_movements for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'inventory_staff', 'admin', 'super_admin')
  );

create policy "inventory_movements_insert_staff"
  on public.inventory_movements for insert
  to authenticated
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));
