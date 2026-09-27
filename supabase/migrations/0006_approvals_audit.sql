-- Phase 3: the lightweight sensitive-action approval workflow and the
-- append-only audit log.

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  action_type public.approval_action_type not null,
  target_table text not null,
  target_id uuid not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.approval_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index idx_approval_requests_status on public.approval_requests (status);

alter table public.approval_requests enable row level security;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_entity on public.audit_logs (entity_table, entity_id);

alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------
-- RLS: approval_requests
-- ---------------------------------------------------------------------

create policy "approval_requests_insert_own"
  on public.approval_requests for insert
  to authenticated
  with check (
    private.current_role() in ('inventory_staff', 'admin')
    and requested_by = auth.uid()
  );

create policy "approval_requests_select_own"
  on public.approval_requests for select
  to authenticated
  using (
    private.current_role() in ('inventory_staff', 'admin')
    and requested_by = auth.uid()
  );

create policy "approval_requests_select_super_admin"
  on public.approval_requests for select
  to authenticated
  using (private.current_role() = 'super_admin');

create policy "approval_requests_update_super_admin"
  on public.approval_requests for update
  to authenticated
  using (private.current_role() = 'super_admin')
  with check (private.current_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- RLS: audit_logs (append-only — deliberately no update/delete policy
-- for any role; that omission is the enforcement)
-- ---------------------------------------------------------------------

create policy "audit_logs_select_own"
  on public.audit_logs for select
  to authenticated
  using (
    private.current_role() in ('inventory_staff', 'admin')
    and actor_id = auth.uid()
  );

create policy "audit_logs_select_super_admin"
  on public.audit_logs for select
  to authenticated
  using (private.current_role() = 'super_admin');

create policy "audit_logs_insert_staff"
  on public.audit_logs for insert
  to authenticated
  with check (
    private.current_role() in ('inventory_staff', 'admin', 'super_admin')
    and actor_id = auth.uid()
  );
