-- Phase 7: order creation, the order/inventory bridge, and the status
-- workflow. Two new public functions, one new private helper, and two
-- Phase 3 payments RLS policies removed. No table/column changes.

-- ---------------------------------------------------------------------
-- private.apply_order_stock_movement(): the only path by which an order
-- affects stock. Mirrors record_inventory_movement()'s atomic
-- insert-then-update pattern, but is deliberately a SEPARATE function in
-- the non-exposed `private` schema rather than an extension of the
-- Phase 5 RPC — record_inventory_movement() stays untouched, still
-- rejecting 'sale'/'return' and any reference_order_id, exactly as
-- shipped. Reachable only from place_order()/update_order_status()
-- (both SECURITY DEFINER); never directly callable via PostgREST.
-- security invoker is sufficient (not definer): by the time this is
-- called, execution is already running under the calling DEFINER
-- function's elevated context, so there is no privilege this function
-- itself needs to add.
-- ---------------------------------------------------------------------

create or replace function private.apply_order_stock_movement(
  p_product_id uuid,
  p_movement_type public.movement_type,
  p_quantity integer,
  p_order_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_delta integer;
begin
  if p_movement_type not in ('sale', 'return') then
    raise exception 'apply_order_stock_movement only supports sale/return';
  end if;

  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  v_delta := case when p_movement_type = 'sale' then -p_quantity else p_quantity end;

  insert into public.inventory_movements (
    product_id, movement_type, quantity_delta, reason,
    supplier_id, reference_order_id, performed_by
  )
  values (
    p_product_id, p_movement_type, v_delta, null,
    null, p_order_id, auth.uid()
  );

  update public.inventory
  set quantity_on_hand = quantity_on_hand + v_delta
  where product_id = p_product_id;

  if not found then
    raise exception 'no inventory row found for product %', p_product_id;
  end if;
end;
$$;

revoke execute on function private.apply_order_stock_movement(
  uuid, public.movement_type, integer, uuid
) from public;

-- ---------------------------------------------------------------------
-- public.place_order(): the only path by which an order is created.
-- ---------------------------------------------------------------------

create or replace function public.place_order(
  p_customer_id uuid,
  p_items jsonb,
  p_shipping_address jsonb,
  p_payment_method public.payment_method,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role public.user_role;
  v_item jsonb;
  v_item_count integer;
  v_distinct_count integer;
  v_product record;
  v_unit_price numeric(10, 2);
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_order public.orders;
  v_problems text := '';
begin
  -- Authorization
  v_role := private.current_role();

  if v_role is null then
    raise exception 'not authorized';
  end if;

  if v_role = 'customer' then
    if p_customer_id <> auth.uid() then
      raise exception 'not authorized';
    end if;
  elsif v_role in ('sales_staff', 'admin', 'super_admin') then
    if not exists (
      select 1 from public.profiles where id = p_customer_id and role = 'customer'
    ) then
      raise exception 'target customer not found';
    end if;
  else
    raise exception 'not authorized';
  end if;

  -- p_items shape validation — every check runs before any cast, so
  -- malformed direct RPC input fails with a controlled error rather than
  -- a raw Postgres cast exception.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each order item must be a JSON object';
    end if;

    if not (v_item ? 'product_id') or jsonb_typeof(v_item -> 'product_id') <> 'string' then
      raise exception 'each order item must have a product_id';
    end if;

    if (v_item ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid product_id in order items';
    end if;

    if not (v_item ? 'quantity') or jsonb_typeof(v_item -> 'quantity') <> 'number' then
      raise exception 'each order item must have a quantity';
    end if;

    if (v_item ->> 'quantity')::numeric <> floor((v_item ->> 'quantity')::numeric)
       or (v_item ->> 'quantity')::numeric <= 0 then
      raise exception 'quantity must be a positive integer';
    end if;

    if (v_item ->> 'quantity')::numeric > 2147483647 then
      raise exception 'quantity is too large';
    end if;
  end loop;

  select count(*), count(distinct (elem ->> 'product_id'))
  into v_item_count, v_distinct_count
  from jsonb_array_elements(p_items) elem;

  if v_item_count <> v_distinct_count then
    raise exception 'duplicate product_id in order items';
  end if;

  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    raise exception 'shipping address is required';
  end if;

  -- Upfront combined availability/stock validation — one clear error
  -- listing every problem, rather than failing opaquely on the first.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select p.id, p.is_active, i.quantity_on_hand
    into v_product
    from public.products p
    join public.inventory i on i.product_id = p.id
    where p.id = (v_item ->> 'product_id')::uuid;

    if not found or not v_product.is_active then
      v_problems := v_problems || format('%s (unavailable); ', v_item ->> 'product_id');
    elsif v_product.quantity_on_hand < (v_item ->> 'quantity')::integer then
      v_problems := v_problems
        || format('%s (only %s in stock); ', v_item ->> 'product_id', v_product.quantity_on_hand);
    end if;
  end loop;

  if v_problems <> '' then
    raise exception 'some items are unavailable: %', v_problems;
  end if;

  -- Pricing is always server-derived — p_items never carries a price.
  v_subtotal := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select price into v_unit_price from public.products where id = (v_item ->> 'product_id')::uuid;
    v_subtotal := v_subtotal + (v_unit_price * (v_item ->> 'quantity')::integer);
  end loop;

  -- Tax/shipping fixed at 0 — deliberate MVP simplification, not a real
  -- rate engine.
  v_total := v_subtotal;

  insert into public.orders (
    customer_id, placed_by, status, subtotal, tax, shipping_fee, total, shipping_address, notes
  )
  values (
    p_customer_id, auth.uid(), 'pending', v_subtotal, 0, 0, v_total, p_shipping_address, p_notes
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select price into v_unit_price from public.products where id = (v_item ->> 'product_id')::uuid;

    insert into public.order_items (order_id, product_id, quantity, unit_price)
    values (v_order.id, (v_item ->> 'product_id')::uuid, (v_item ->> 'quantity')::integer, v_unit_price);

    perform private.apply_order_stock_movement(
      (v_item ->> 'product_id')::uuid, 'sale', (v_item ->> 'quantity')::integer, v_order.id
    );
  end loop;

  -- Payment simulated as instantly successful — no real gateway exists;
  -- see update_order_status() for what cancellation does (and does not)
  -- do to this row.
  insert into public.payments (order_id, amount, method, status, paid_at)
  values (v_order.id, v_total, p_payment_method, 'paid', now());

  return v_order;
end;
$$;

revoke execute on function public.place_order(
  uuid, jsonb, jsonb, public.payment_method, text
) from public;
revoke execute on function public.place_order(
  uuid, jsonb, jsonb, public.payment_method, text
) from anon;
grant execute on function public.place_order(
  uuid, jsonb, jsonb, public.payment_method, text
) to authenticated;

-- ---------------------------------------------------------------------
-- public.update_order_status(): the only path by which an order's
-- status changes. Cancellation (pre-shipment only) restores stock via
-- apply_order_stock_movement('return', ...) but deliberately never
-- touches payments — see the design notes already approved for why
-- payment.status stays 'paid' after a cancellation.
-- ---------------------------------------------------------------------

create or replace function public.update_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_reason text default null
)
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
    -- Constrained lookup: a customer's query can only ever resolve
    -- their own order, never load someone else's row to check after
    -- the fact.
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

revoke execute on function public.update_order_status(
  uuid, public.order_status, text
) from public;
revoke execute on function public.update_order_status(
  uuid, public.order_status, text
) from anon;
grant execute on function public.update_order_status(
  uuid, public.order_status, text
) to authenticated;

-- ---------------------------------------------------------------------
-- payments: remove the direct write surface. All payment creation now
-- happens exclusively inside place_order() (SECURITY DEFINER). Leaving
-- payments_insert_staff/payments_update_admin in place would let any
-- sales_staff insert an arbitrary payment row for any order, completely
-- disconnected from a real transaction — exactly the risk Phase 7's
-- "writes only through controlled functions" design is meant to close.
-- SELECT policies (payments_select_own/_staff) are untouched.
-- ---------------------------------------------------------------------

drop policy "payments_insert_staff" on public.payments;
drop policy "payments_update_admin" on public.payments;
