-- Phase 9: approval / basic audit workflow. Reuses the Phase 3
-- approval_requests / audit_logs tables and approval_action_type /
-- approval_status enums exactly as they were designed — no new tables,
-- no new enum values (delete_supplier and inventory_adjustment stay
-- deliberately out of scope, per the approved plan).
--
-- Five sensitive actions become approval-gated: delete_product,
-- deactivate_staff, change_role, cancel_paid_order, refund_payment.
-- inventory_adjustment (record_inventory_movement) and supplier deletion
-- stay direct, unchanged.

-- ---------------------------------------------------------------------
-- RLS: approval_requests — requester access is now action_type-specific,
-- not a flat role list. inventory_staff is capped at delete_product only;
-- sales_staff is capped at cancel_paid_order/refund_payment only; admin
-- is intentionally the broad role across all five. super_admin never
-- requests, only reviews (unchanged, approval_requests_select_super_admin
-- is untouched).
-- ---------------------------------------------------------------------

drop policy "approval_requests_insert_own" on public.approval_requests;

create policy "approval_requests_insert_own"
  on public.approval_requests for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and (
      (private.current_role() = 'inventory_staff' and action_type = 'delete_product')
      or (private.current_role() = 'admin' and action_type in
            ('delete_product', 'deactivate_staff', 'change_role', 'cancel_paid_order', 'refund_payment'))
      or (private.current_role() = 'sales_staff' and action_type in
            ('cancel_paid_order', 'refund_payment'))
    )
  );

drop policy "approval_requests_select_own" on public.approval_requests;

create policy "approval_requests_select_own"
  on public.approval_requests for select
  to authenticated
  using (
    private.current_role() in ('inventory_staff', 'admin', 'sales_staff')
    and requested_by = auth.uid()
  );

-- Dropped, not replaced: every status transition must now go through
-- review_approval_request() so status = 'approved' can never be recorded
-- without its paired side effect actually running — same reasoning as
-- orders/order_items having zero UPDATE policy since Phase 3.
drop policy "approval_requests_update_super_admin" on public.approval_requests;

-- ---------------------------------------------------------------------
-- RLS: products — DELETE capability removed from inventory_staff/admin.
-- Without this, approval is optional: they could still delete directly
-- via a raw REST call. super_admin retains direct delete (consistent
-- with their existing unilateral power elsewhere, e.g.
-- profiles_update_super_admin). INSERT/UPDATE unchanged for all three.
-- ---------------------------------------------------------------------

drop policy "products_write_staff" on public.products;

create policy "products_insert_staff"
  on public.products for insert
  to authenticated
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

create policy "products_update_staff"
  on public.products for update
  to authenticated
  using (private.current_role() in ('inventory_staff', 'admin', 'super_admin'))
  with check (private.current_role() in ('inventory_staff', 'admin', 'super_admin'));

create policy "products_delete_super_admin"
  on public.products for delete
  to authenticated
  using (private.current_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- update_order_status(): staff (sales_staff/admin) can no longer cancel
-- an order directly — that's exactly the "cancel a paid order" sensitive
-- action, now gated behind create_approval_request()/
-- review_approval_request(). super_admin keeps direct cancel. Customer
-- self-cancellation of their own pending order is completely unchanged.
-- Forward status progression (pending -> ... -> delivered) is unchanged
-- for all three staff roles.
-- ---------------------------------------------------------------------

create or replace function public.update_order_status(p_order_id uuid, p_new_status public.order_status, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role public.user_role;
  v_order public.orders;
  v_item record;
  v_reason text;
  v_legal boolean := false;
begin
  v_role := private.current_role();

  if v_role is null then
    raise exception 'not authorized';
  end if;

  if v_role in ('sales_staff', 'admin', 'super_admin') then
    select * into v_order from public.orders where id = p_order_id;

    if not found then
      raise exception 'order not found';
    end if;

  elsif v_role = 'customer' then
    select * into v_order
    from public.orders
    where id = p_order_id and customer_id = auth.uid();

    if not found then
      raise exception 'not authorized';
    end if;

    if p_new_status <> 'cancelled' or v_order.status <> 'pending' then
      raise exception 'customers may only cancel a pending order';
    end if;

  else
    raise exception 'not authorized';
  end if;

  v_reason := nullif(trim(both from p_reason), '');

  if p_new_status = 'cancelled' then
    if v_role in ('sales_staff', 'admin') then
      raise exception 'staff cancellation of an order requires approval — submit an approval request instead';
    end if;

    if v_order.status not in ('pending', 'confirmed', 'processing') then
      raise exception 'order cannot be cancelled once shipped — returns are not supported in this phase';
    end if;
    if v_reason is null then
      raise exception 'a reason is required to cancel an order';
    end if;
    v_legal := true;
  elsif v_role in ('sales_staff', 'admin', 'super_admin') then
    v_legal := (v_order.status = 'pending' and p_new_status = 'confirmed')
      or (v_order.status = 'confirmed' and p_new_status = 'processing')
      or (v_order.status = 'processing' and p_new_status = 'shipped')
      or (v_order.status = 'shipped' and p_new_status = 'delivered');
  end if;

  if not v_legal then
    raise exception 'illegal status transition from % to %', v_order.status, p_new_status;
  end if;

  if p_new_status = 'cancelled' then
    for v_item in select product_id, quantity from public.order_items where order_id = p_order_id
    loop
      perform private.apply_order_stock_movement(v_item.product_id, 'return', v_item.quantity, p_order_id);
    end loop;
  end if;

  update public.orders
  set status = p_new_status
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- create_approval_request(): SECURITY INVOKER — the underlying insert is
-- already RLS-permitted per the policy above, no privilege elevation
-- needed. Validates the requester role against the action_type, the
-- action_type against target_table, and target-specific business rules,
-- all revalidated again (identically) inside review_approval_request()
-- at approval time, since state can change in between.
-- ---------------------------------------------------------------------

create or replace function public.create_approval_request(
  p_action_type public.approval_action_type,
  p_target_table text,
  p_target_id uuid,
  p_reason text,
  p_payload jsonb default '{}'::jsonb
)
returns public.approval_requests
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_role public.user_role;
  v_reason text;
  v_target_profile public.profiles;
  v_target_order public.orders;
  v_target_payment public.payments;
  v_request public.approval_requests;
begin
  v_role := private.current_role();

  if v_role is null then
    raise exception 'not authorized';
  end if;

  if not (
    (v_role = 'inventory_staff' and p_action_type = 'delete_product')
    or (v_role = 'admin' and p_action_type in
          ('delete_product', 'deactivate_staff', 'change_role', 'cancel_paid_order', 'refund_payment'))
    or (v_role = 'sales_staff' and p_action_type in ('cancel_paid_order', 'refund_payment'))
  ) then
    raise exception 'not authorized to request this action type';
  end if;

  v_reason := nullif(trim(both from p_reason), '');
  if v_reason is null then
    raise exception 'a reason is required';
  end if;

  if p_target_id is null then
    raise exception 'target_id is required';
  end if;

  if p_action_type = 'delete_product' then
    if p_target_table <> 'products' then
      raise exception 'target_table must be products for delete_product';
    end if;

    if not exists (select 1 from public.products where id = p_target_id) then
      raise exception 'product not found';
    end if;

    if exists (select 1 from public.order_items where product_id = p_target_id) then
      raise exception 'cannot delete: product has order history';
    end if;

    if exists (select 1 from public.inventory_movements where product_id = p_target_id) then
      raise exception 'cannot delete: product has movement history';
    end if;

  elsif p_action_type = 'deactivate_staff' then
    if p_target_table <> 'profiles' then
      raise exception 'target_table must be profiles for deactivate_staff';
    end if;

    select * into v_target_profile from public.profiles where id = p_target_id;

    if not found then
      raise exception 'profile not found';
    end if;
    if v_target_profile.role = 'customer' then
      raise exception 'deactivate_staff cannot target a customer account';
    end if;
    if v_target_profile.role = 'super_admin' then
      raise exception 'cannot target a super_admin through the approval workflow';
    end if;

  elsif p_action_type = 'change_role' then
    if p_target_table <> 'profiles' then
      raise exception 'target_table must be profiles for change_role';
    end if;

    select * into v_target_profile from public.profiles where id = p_target_id;

    if not found then
      raise exception 'profile not found';
    end if;
    if v_target_profile.role = 'customer' then
      raise exception 'change_role cannot target a customer account';
    end if;
    if v_target_profile.role = 'super_admin' then
      raise exception 'cannot target a super_admin through the approval workflow';
    end if;

    if (p_payload ->> 'new_role') is null
       or (p_payload ->> 'new_role') not in ('sales_staff', 'inventory_staff', 'admin') then
      raise exception 'new_role must be one of sales_staff, inventory_staff, admin';
    end if;

  elsif p_action_type = 'cancel_paid_order' then
    if p_target_table <> 'orders' then
      raise exception 'target_table must be orders for cancel_paid_order';
    end if;

    select * into v_target_order from public.orders where id = p_target_id;

    if not found then
      raise exception 'order not found';
    end if;
    if v_target_order.status not in ('pending', 'confirmed', 'processing') then
      raise exception 'order cannot be cancelled once shipped';
    end if;

  elsif p_action_type = 'refund_payment' then
    if p_target_table <> 'payments' then
      raise exception 'target_table must be payments for refund_payment';
    end if;

    select * into v_target_payment from public.payments where id = p_target_id;

    if not found then
      raise exception 'payment not found';
    end if;
    if v_target_payment.status <> 'paid' then
      raise exception 'payment is not in a refundable state';
    end if;

    select * into v_target_order from public.orders where id = v_target_payment.order_id;

    if v_target_order.status <> 'cancelled' then
      raise exception 'order is not cancelled';
    end if;

    if not exists (
      select 1 from public.approval_requests
      where target_table = 'orders'
        and target_id = v_target_order.id
        and action_type = 'cancel_paid_order'
        and status = 'approved'
    ) then
      raise exception 'order was not cancelled through the approved cancellation flow';
    end if;

  else
    raise exception 'unsupported action_type';
  end if;

  if exists (
    select 1 from public.approval_requests
    where target_table = p_target_table
      and target_id = p_target_id
      and action_type = p_action_type
      and status = 'pending'
  ) then
    raise exception 'a pending request for this action already exists';
  end if;

  insert into public.approval_requests (
    requested_by, action_type, target_table, target_id, reason, payload, status
  )
  values (
    auth.uid(), p_action_type, p_target_table, p_target_id, v_reason, p_payload, 'pending'
  )
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function public.create_approval_request(public.approval_action_type, text, uuid, text, jsonb) from public;
revoke execute on function public.create_approval_request(public.approval_action_type, text, uuid, text, jsonb) from anon;
grant execute on function public.create_approval_request(public.approval_action_type, text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- review_approval_request(): SECURITY DEFINER — must reach orders/
-- payments/profiles/products, none of which the reviewer (super_admin)
-- has full direct RLS write access to in every case (payments has zero
-- write policy for anyone). Re-validates every target condition again
-- at approval time rather than trusting the request's original state.
-- Writes exactly one audit_logs row per review (approved or rejected) —
-- the only audit_logs write path in this phase; request creation does
-- not write one (approval_requests itself is that record).
-- ---------------------------------------------------------------------

create or replace function public.review_approval_request(
  p_request_id uuid,
  p_decision public.approval_status,
  p_review_note text default null
)
returns public.approval_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role public.user_role;
  v_request public.approval_requests;
  v_review_note text;
  v_target_profile public.profiles;
  v_target_order public.orders;
  v_target_payment public.payments;
  v_target_product public.products;
  v_old_value jsonb;
  v_new_value jsonb;
  v_item record;
begin
  v_role := private.current_role();

  if v_role is null or v_role <> 'super_admin' then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select * into v_request from public.approval_requests where id = p_request_id for update;

  if not found then
    raise exception 'approval request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'this request has already been reviewed';
  end if;

  if v_request.requested_by = auth.uid() then
    raise exception 'cannot review your own request';
  end if;

  v_review_note := nullif(trim(both from p_review_note), '');

  if p_decision = 'rejected' then
    update public.approval_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_review_note
    where id = p_request_id
    returning * into v_request;

    insert into public.audit_logs (actor_id, action, entity_table, entity_id, old_value, new_value, approval_request_id)
    values (
      auth.uid(), 'approval_rejected', v_request.target_table, v_request.target_id,
      null, jsonb_build_object('review_note', v_review_note), v_request.id
    );

    return v_request;
  end if;

  -- p_decision = 'approved': revalidate target state, then perform the
  -- side effect. Every branch mirrors create_approval_request()'s checks.
  if v_request.action_type = 'delete_product' then
    select * into v_target_product from public.products where id = v_request.target_id for update;

    if not found then
      raise exception 'product not found';
    end if;
    if exists (select 1 from public.order_items where product_id = v_request.target_id) then
      raise exception 'cannot delete: product has order history';
    end if;
    if exists (select 1 from public.inventory_movements where product_id = v_request.target_id) then
      raise exception 'cannot delete: product has movement history';
    end if;

    v_old_value := to_jsonb(v_target_product);
    delete from public.products where id = v_request.target_id;
    v_new_value := null;

  elsif v_request.action_type = 'deactivate_staff' then
    select * into v_target_profile from public.profiles where id = v_request.target_id for update;

    if not found then
      raise exception 'profile not found';
    end if;
    if v_target_profile.role = 'customer' then
      raise exception 'deactivate_staff cannot target a customer account';
    end if;
    if v_target_profile.role = 'super_admin' then
      raise exception 'cannot target a super_admin through the approval workflow';
    end if;

    v_old_value := to_jsonb(v_target_profile);
    update public.profiles set is_active = false where id = v_request.target_id
    returning to_jsonb(profiles.*) into v_new_value;

  elsif v_request.action_type = 'change_role' then
    select * into v_target_profile from public.profiles where id = v_request.target_id for update;

    if not found then
      raise exception 'profile not found';
    end if;
    if v_target_profile.role = 'customer' then
      raise exception 'change_role cannot target a customer account';
    end if;
    if v_target_profile.role = 'super_admin' then
      raise exception 'cannot target a super_admin through the approval workflow';
    end if;
    if (v_request.payload ->> 'new_role') is null
       or (v_request.payload ->> 'new_role') not in ('sales_staff', 'inventory_staff', 'admin') then
      raise exception 'new_role must be one of sales_staff, inventory_staff, admin';
    end if;

    v_old_value := to_jsonb(v_target_profile);
    update public.profiles
    set role = (v_request.payload ->> 'new_role')::public.user_role
    where id = v_request.target_id
    returning to_jsonb(profiles.*) into v_new_value;

  elsif v_request.action_type = 'cancel_paid_order' then
    select * into v_target_order from public.orders where id = v_request.target_id for update;

    if not found then
      raise exception 'order not found';
    end if;
    if v_target_order.status not in ('pending', 'confirmed', 'processing') then
      raise exception 'order cannot be cancelled once shipped';
    end if;

    v_old_value := to_jsonb(v_target_order);

    for v_item in select product_id, quantity from public.order_items where order_id = v_target_order.id
    loop
      perform private.apply_order_stock_movement(v_item.product_id, 'return', v_item.quantity, v_target_order.id);
    end loop;

    update public.orders set status = 'cancelled' where id = v_target_order.id
    returning to_jsonb(orders.*) into v_new_value;

  elsif v_request.action_type = 'refund_payment' then
    select * into v_target_payment from public.payments where id = v_request.target_id for update;

    if not found then
      raise exception 'payment not found';
    end if;
    if v_target_payment.status <> 'paid' then
      raise exception 'payment is not in a refundable state';
    end if;

    select * into v_target_order from public.orders where id = v_target_payment.order_id for update;

    if v_target_order.status <> 'cancelled' then
      raise exception 'order is not cancelled';
    end if;

    if not exists (
      select 1 from public.approval_requests
      where target_table = 'orders'
        and target_id = v_target_order.id
        and action_type = 'cancel_paid_order'
        and status = 'approved'
    ) then
      raise exception 'order was not cancelled through the approved cancellation flow';
    end if;

    v_old_value := jsonb_build_object('payment', to_jsonb(v_target_payment), 'order', to_jsonb(v_target_order));

    update public.payments set status = 'refunded' where id = v_target_payment.id;
    update public.orders set status = 'refunded' where id = v_target_order.id;

    select to_jsonb(p2.*) into v_new_value from public.payments p2 where p2.id = v_target_payment.id;

  else
    raise exception 'unsupported action_type';
  end if;

  update public.approval_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_review_note
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, old_value, new_value, approval_request_id)
  values (auth.uid(), 'approval_approved', v_request.target_table, v_request.target_id, v_old_value, v_new_value, v_request.id);

  return v_request;
end;
$$;

revoke execute on function public.review_approval_request(uuid, public.approval_status, text) from public;
revoke execute on function public.review_approval_request(uuid, public.approval_status, text) from anon;
grant execute on function public.review_approval_request(uuid, public.approval_status, text) to authenticated;
