-- Phase 6: CRM read/aggregation surface. Two additive objects only — no
-- existing tables, columns, or RLS policies are touched.

-- ---------------------------------------------------------------------
-- customer_metrics: one row per customer, including customers with zero
-- orders. Built with profiles LEFT JOIN orders (not an aggregation over
-- orders alone) so every customer is represented. security_invoker means
-- visibility is governed entirely by the existing profiles RLS policies
-- (a customer sees only their own row via profiles_select_own; staff see
-- every customer row via profiles_select_customers_for_staff /
-- profiles_select_all_for_admin) — no new RLS policy is needed.
-- ---------------------------------------------------------------------

create view public.customer_metrics
with (security_invoker = true)
as
select
  p.id as profile_id,
  count(o.id) as order_count,
  coalesce(
    sum(o.total) filter (where o.status not in ('cancelled', 'refunded')),
    0
  ) as lifetime_spend,
  min(o.created_at) as first_order_at,
  max(o.created_at) as last_order_at
from public.profiles p
left join public.orders o on o.customer_id = p.id
where p.role = 'customer'
group by p.id;

grant select on public.customer_metrics to authenticated;

-- ---------------------------------------------------------------------
-- customer_contact_email(): staff-only lookup of a customer's email.
-- Nothing today exposes auth.users.email to the app for anyone other than
-- the signed-in user themself (via their own session), so staff have no
-- way to see a customer's email without this. Lives in public (not
-- private) specifically so supabase-js can call it as an RPC — unlike
-- current_role()/handle_new_user(), which are deliberately unreachable
-- from the client. Security definer is required to read auth.users;
-- every mitigation the security checklist calls for is applied: pinned
-- search_path, schema-qualified references, an internal caller-role
-- check, a target-is-a-customer check, a minimal single-scalar return,
-- and execute revoked from public/anon, granted only to authenticated.
--
-- Two things verified live and fixed here, not just assumed:
-- 1. Supabase auto-grants EXECUTE on new public-schema functions directly
--    to anon/authenticated via default privileges — `revoke ... from
--    public` does NOT strip that direct grant, so anon is revoked
--    explicitly too.
-- 2. `current_role() not in (...)` evaluates to NULL (not TRUE) when
--    current_role() itself is NULL — exactly the case for an anonymous
--    caller with no auth.uid() — so the check is written to explicitly
--    reject a NULL role rather than relying on NOT IN's NULL handling.
-- ---------------------------------------------------------------------

create or replace function public.customer_contact_email(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text;
  v_caller_role public.user_role;
begin
  v_caller_role := private.current_role();

  if v_caller_role is null or v_caller_role not in ('sales_staff', 'admin', 'super_admin') then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_profile_id and role = 'customer'
  ) then
    return null;
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = p_profile_id;

  return v_email;
end;
$$;

revoke execute on function public.customer_contact_email(uuid) from public;
revoke execute on function public.customer_contact_email(uuid) from anon;
grant execute on function public.customer_contact_email(uuid) to authenticated;
