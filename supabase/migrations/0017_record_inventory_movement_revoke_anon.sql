-- Revoke EXECUTE from anon on record_inventory_movement
-- Supabase PostgREST requires explicit revoke from anon in addition to public.
revoke execute on function public.record_inventory_movement(
  uuid, public.movement_type, integer, text, uuid, uuid
) from anon;

revoke execute on function public.record_inventory_movement(
  uuid, public.movement_type, integer, text, uuid, uuid
) from public;

grant execute on function public.record_inventory_movement(
  uuid, public.movement_type, integer, text, uuid, uuid
) to authenticated;
