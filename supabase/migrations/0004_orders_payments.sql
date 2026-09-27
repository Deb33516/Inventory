-- Phase 3: orders, order items, and payments.
--
-- Deliberately no INSERT/UPDATE/DELETE policies on orders or order_items
-- for ANY role (including admin/super_admin) — mutations are deferred
-- until the Orders phase ships place_order() and status-transition RPCs
-- with real business logic (stock decrement, total calculation). Exposing
-- a raw write surface before that logic exists would let a client create
-- an inconsistent order. Read-only for now.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  placed_by uuid references public.profiles (id) on delete set null,
  status public.order_status not null default 'pending',
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  tax numeric(10, 2) not null default 0 check (tax >= 0),
  shipping_fee numeric(10, 2) not null default 0 check (shipping_fee >= 0),
  total numeric(10, 2) not null check (total >= 0),
  shipping_address jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches_parts check (total = subtotal + tax + shipping_fee)
);

create index idx_orders_customer_id on public.orders (customer_id);
create index idx_orders_status on public.orders (status);
create index idx_orders_created_at on public.orders (created_at);

alter table public.orders enable row level security;

create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  subtotal numeric(10, 2) generated always as (quantity * unit_price) stored
);

create index idx_order_items_order_id on public.order_items (order_id);
create index idx_order_items_product_id on public.order_items (product_id);

alter table public.order_items enable row level security;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  transaction_ref text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_payments_order_id on public.payments (order_id);

alter table public.payments enable row level security;

-- ---------------------------------------------------------------------
-- RLS: orders (select-only in Phase 3 — see note above)
-- ---------------------------------------------------------------------

create policy "orders_select_own"
  on public.orders for select
  to authenticated
  using (customer_id = auth.uid());

create policy "orders_select_staff"
  on public.orders for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'inventory_staff', 'admin', 'super_admin')
  );

-- ---------------------------------------------------------------------
-- RLS: order_items (select-only, mirrors the parent order's visibility)
-- ---------------------------------------------------------------------

create policy "order_items_select_own"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
    )
  );

create policy "order_items_select_staff"
  on public.order_items for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'inventory_staff', 'admin', 'super_admin')
  );

-- ---------------------------------------------------------------------
-- RLS: payments
-- ---------------------------------------------------------------------

create policy "payments_select_own"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and o.customer_id = auth.uid()
    )
  );

create policy "payments_select_staff"
  on public.payments for select
  to authenticated
  using (private.current_role() in ('sales_staff', 'admin', 'super_admin'));

create policy "payments_insert_staff"
  on public.payments for insert
  to authenticated
  with check (private.current_role() in ('sales_staff', 'admin', 'super_admin'));

create policy "payments_update_admin"
  on public.payments for update
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'))
  with check (private.current_role() in ('admin', 'super_admin'));
