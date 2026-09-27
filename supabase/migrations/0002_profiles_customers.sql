-- Phase 3: profiles (identity + role), customers (CRM extension),
-- the recursion-safe role helper, and signup provisioning.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on public.profiles (role);

alter table public.profiles enable row level security;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  billing_address jsonb,
  shipping_address jsonb,
  notes text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Generic updated_at bump, reused by every table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Recursion-safe role helper: security definer so its internal lookup
-- bypasses profiles' own RLS entirely (nothing left to recurse into),
-- lives in the non-exposed `private` schema, and pins search_path so it
-- can't be hijacked by a same-named object earlier in the caller's path.
create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke execute on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;

-- Auto-provision profile + customer row on signup. Security definer
-- because the new user has no session yet when this fires; scoped
-- tightly, schema-qualified, search_path pinned, execute revoked from
-- public, and kept in `private` so it's never reachable as an RPC.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.customers (profile_id)
  values (new.id);

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_select_customers_for_staff"
  on public.profiles for select
  to authenticated
  using (
    private.current_role() in ('sales_staff', 'admin', 'super_admin')
    and role = 'customer'
  );

create policy "profiles_select_all_for_admin"
  on public.profiles for select
  to authenticated
  using (private.current_role() in ('admin', 'super_admin'));

-- Anyone may update their own row, but cannot change their own role —
-- the new row's role must equal whatever current_role() (freshly read,
-- unaffected by this in-flight update) already says it is.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and role = private.current_role());

create policy "profiles_update_super_admin"
  on public.profiles for update
  to authenticated
  using (private.current_role() = 'super_admin')
  with check (private.current_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- RLS: customers
-- ---------------------------------------------------------------------

create policy "customers_select_own"
  on public.customers for select
  to authenticated
  using (profile_id = auth.uid());

create policy "customers_update_own"
  on public.customers for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "customers_select_staff"
  on public.customers for select
  to authenticated
  using (private.current_role() in ('sales_staff', 'admin', 'super_admin'));

create policy "customers_update_staff"
  on public.customers for update
  to authenticated
  using (private.current_role() in ('sales_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('sales_staff', 'admin', 'super_admin'));
