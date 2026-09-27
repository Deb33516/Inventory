-- Phase 5: inventory mutation surface. Two additive objects only — no
-- existing tables, columns, enum values, or RLS policies are touched.

-- ---------------------------------------------------------------------
-- Product -> inventory provisioning trigger
-- ---------------------------------------------------------------------

-- Guarantees every product has a matching inventory row from the moment
-- it's created. Security invoker, not definer: the only roles allowed to
-- insert into products (inventory_staff/admin/super_admin, via
-- products_write_staff) are exactly the roles inventory's own insert
-- policy (inventory_insert_staff) already permits, so the inserting
-- user's own privileges are sufficient — no elevation needed. Actual
-- stock levels are never touched here again; all real mutations go
-- through record_inventory_movement() below. A `returns trigger`
-- function can only ever fire as a trigger, so no execute revoke is
-- needed the way private.handle_new_user() requires.
create or replace function public.provision_product_inventory()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  insert into public.inventory (product_id, quantity_on_hand, reorder_level)
  values (new.id, 0, 0);
  return new;
end;
$$;

create trigger provision_product_inventory
  after insert on public.products
  for each row execute function public.provision_product_inventory();

-- ---------------------------------------------------------------------
-- record_inventory_movement(): the only path by which quantity_on_hand
-- may change. Inserts the immutable ledger row and updates the running
-- total atomically (single function invocation, no exception handler
-- inside it, so any error unwinds both writes together).
-- ---------------------------------------------------------------------

create or replace function public.record_inventory_movement(
  p_product_id uuid,
  p_movement_type public.movement_type,
  p_quantity_delta integer,
  p_reason text default null,
  p_supplier_id uuid default null,
  p_reference_order_id uuid default null
)
returns public.inventory
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_delta integer;
  v_reason text;
  v_inventory public.inventory;
begin
  -- Only the movement types Phase 5 implements. 'sale'/'return' are
  -- reserved for the Orders phase, which will need order-linkage
  -- validation this function doesn't do.
  if p_movement_type not in ('restock', 'adjustment', 'damaged') then
    raise exception 'movement_type % is not supported yet', p_movement_type;
  end if;

  -- Order-linked movements belong to the Orders phase. Phase 5 rejects
  -- any non-null reference even though the parameter/column already
  -- exist, so the boundary is enforced here rather than left to the
  -- caller's discipline.
  if p_reference_order_id is not null then
    raise exception 'reference_order_id is not supported in this phase';
  end if;

  -- Whitespace-only reasons don't count as provided.
  v_reason := nullif(trim(both from p_reason), '');

  if p_movement_type = 'restock' then
    if p_quantity_delta <= 0 then
      raise exception 'restock requires a positive quantity';
    end if;
    v_delta := p_quantity_delta;
  elsif p_movement_type = 'damaged' then
    if p_quantity_delta = 0 then
      raise exception 'damaged requires a non-zero quantity';
    end if;
    if v_reason is null then
      raise exception 'damaged requires a reason';
    end if;
    v_delta := -abs(p_quantity_delta);
  else -- adjustment
    if p_quantity_delta = 0 then
      raise exception 'adjustment requires a non-zero quantity';
    end if;
    if v_reason is null then
      raise exception 'adjustment requires a reason';
    end if;
    v_delta := p_quantity_delta;
  end if;

  if p_supplier_id is not null and p_movement_type <> 'restock' then
    raise exception 'supplier_id is only allowed for restock movements';
  end if;

  insert into public.inventory_movements (
    product_id, movement_type, quantity_delta, reason,
    supplier_id, reference_order_id, performed_by
  )
  values (
    p_product_id, p_movement_type, v_delta, v_reason,
    p_supplier_id, p_reference_order_id, auth.uid()
  );

  update public.inventory
  set quantity_on_hand = quantity_on_hand + v_delta
  where product_id = p_product_id
  returning * into v_inventory;

  if not found then
    raise exception 'no inventory row found for product %', p_product_id;
  end if;

  return v_inventory;
end;
$$;

revoke execute on function public.record_inventory_movement(
  uuid, public.movement_type, integer, text, uuid, uuid
) from public;
grant execute on function public.record_inventory_movement(
  uuid, public.movement_type, integer, text, uuid, uuid
) to authenticated;
