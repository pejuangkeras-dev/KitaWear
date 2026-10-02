-- Priority 8 — Admin Center completion and audit logging
-- Idempotent reference migration for the deployed Admin Center backend.
-- Safe to re-run against the existing MarketKita project.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);

create index if not exists admin_audit_logs_entity_idx
  on public.admin_audit_logs(entity_type, entity_id);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "admin_audit_logs_admin_select" on public.admin_audit_logs;
create policy "admin_audit_logs_admin_select"
  on public.admin_audit_logs
  for select
  to authenticated
  using ((select public.is_admin()));

create or replace function public.admin_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  entity uuid;
  payload jsonb;
begin
  if actor is null or not public.is_admin() then
    return coalesce(new, old);
  end if;

  entity := coalesce(new.id, old.id);

  payload := jsonb_build_object(
    'old', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    'new', case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  insert into public.admin_audit_logs(
    actor_id, action, entity_type, entity_id, metadata
  )
  values (
    actor, tg_op, tg_table_name, entity, payload
  );

  return coalesce(new, old);
end
$$;

revoke execute on function public.admin_audit_trigger() from public, anon, authenticated;

create or replace function public.admin_set_product_status(
  p_product_id uuid,
  p_status public.product_status
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.products
  set status = p_status, updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'status', p_status
  );
end
$$;

create or replace function public.admin_set_store_status(
  p_store_id uuid,
  p_status public.store_status
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.stores
  set status = p_status, updated_at = now()
  where id = p_store_id;

  if not found then
    raise exception 'STORE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok', true,
    'store_id', p_store_id,
    'status', p_status
  );
end
$$;

revoke execute on function public.admin_set_product_status(uuid, public.product_status)
  from public, anon;
grant execute on function public.admin_set_product_status(uuid, public.product_status)
  to authenticated, service_role;

revoke execute on function public.admin_set_store_status(uuid, public.store_status)
  from public, anon;
grant execute on function public.admin_set_store_status(uuid, public.store_status)
  to authenticated, service_role;

-- Ensure every existing Admin Center audit trigger is present.
drop trigger if exists admin_audit_orders on public.orders;
create trigger admin_audit_orders
after insert or update or delete on public.orders
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_seller_applications on public.seller_applications;
create trigger admin_audit_seller_applications
after insert or update or delete on public.seller_applications
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_seller_payout_requests on public.seller_payout_requests;
create trigger admin_audit_seller_payout_requests
after insert or update or delete on public.seller_payout_requests
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_disputes on public.disputes;
create trigger admin_audit_disputes
after insert or update or delete on public.disputes
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_refund_requests on public.refund_requests;
create trigger admin_audit_refund_requests
after insert or update or delete on public.refund_requests
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_vouchers on public.vouchers;
create trigger admin_audit_vouchers
after insert or update or delete on public.vouchers
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_products on public.products;
create trigger admin_audit_products
after insert or update or delete on public.products
for each row execute function public.admin_audit_trigger();

drop trigger if exists admin_audit_stores on public.stores;
create trigger admin_audit_stores
after insert or update or delete on public.stores
for each row execute function public.admin_audit_trigger();
