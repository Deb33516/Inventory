-- Phase 3: product catalog — categories and products (what a product is,
-- as distinct from inventory, which is how much of it exists).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  parent_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_categories_parent_id on public.categories (parent_id);

alter table public.categories enable row level security;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  price numeric(10, 2) not null check (price >= 0),
  cost numeric(10, 2) check (cost >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_products_category_id on public.products (category_id);
create index idx_products_is_active on public.products (is_active);

alter table public.products enable row level security;

create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS: categories (reference data — open read, staff-only write)
-- ---------------------------------------------------------------------

create policy "categories_select_public"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "categories_write_staff"
  on public.categories for all
  to authenticated
  using (private.current_role() in ('inventory_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

-- ---------------------------------------------------------------------
-- RLS: products
-- ---------------------------------------------------------------------

create policy "products_select_active_public"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

create policy "products_select_staff"
  on public.products for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'inventory_staff', 'admin', 'super_admin')
  );

create policy "products_write_staff"
  on public.products for all
  to authenticated
  using (private.current_role() in ('inventory_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));
