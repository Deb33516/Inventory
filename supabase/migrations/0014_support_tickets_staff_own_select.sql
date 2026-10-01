-- Bugfix: inventory_staff's "Report an issue" self-report was RLS-blocked
-- on the read-back after insert. createSupportTicket's INSERT is allowed
-- by support_tickets_insert_own, but Postgres RLS also requires the
-- newly-inserted row to satisfy a SELECT policy for `.select().single()`
-- (INSERT ... RETURNING) to succeed. A freshly self-reported ticket has
-- assigned_to = null (not yet triaged), so support_tickets_select_
-- assigned_staff (which requires assigned_to = auth.uid()) doesn't cover
-- it, and no other SELECT policy checks created_by for inventory_staff —
-- only support_tickets_select_own_customer does, for the customer role.
-- Confirmed live via SQL role-impersonation: the INSERT's own WITH CHECK
-- passes; only adding RETURNING triggers "new row violates row-level
-- security policy". No row was ever actually persisted by the failed
-- attempt (Postgres rolls back the whole statement when RETURNING's
-- implicit SELECT check fails).
--
-- Fix: one new, narrowly-scoped SELECT policy, mirroring
-- support_tickets_select_own_customer exactly but for inventory_staff —
-- lets staff see tickets they personally created, nothing broader (not
-- the general unassigned queue, not other staff/customers' tickets).
-- Does not touch/replace any existing policy on this table.
create policy "support_tickets_select_own_staff"
  on public.support_tickets for select
  to authenticated
  using (
    private.current_role() = 'inventory_staff'
    and created_by = auth.uid()
  );
