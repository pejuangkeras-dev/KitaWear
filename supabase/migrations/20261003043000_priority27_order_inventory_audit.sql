create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  old_status public.order_status,
  new_status public.order_status not null,
  old_payment_status public.payment_status,
  new_payment_status public.payment_status,
  old_shipping_status text,
  new_shipping_status text,
  changed_at timestamptz not null default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events(order_id, changed_at desc);

alter table public.order_status_events enable row level security;
revoke all on table public.order_status_events from anon, authenticated;

create policy "order_status_events_no_client_access"
  on public.order_status_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.audit_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.status is distinct from new.status)
     or (old.payment_status is distinct from new.payment_status)
     or (old.shipping_status is distinct from new.shipping_status) then
    insert into public.order_status_events(
      order_id, old_status, new_status,
      old_payment_status, new_payment_status,
      old_shipping_status, new_shipping_status
    )
    values(
      new.id, old.status, new.status,
      old.payment_status, new.payment_status,
      old.shipping_status, new.shipping_status
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_order_status_change() from public, anon, authenticated;

drop trigger if exists trg_audit_order_status_change on public.orders;
create trigger trg_audit_order_status_change
after update of status, payment_status, shipping_status on public.orders
for each row
execute function public.audit_order_status_change();

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  product_size_id uuid references public.product_sizes(id) on delete set null,
  product_id uuid,
  size text,
  old_stock integer,
  new_stock integer,
  delta integer,
  reason text not null default 'stock_change',
  order_id uuid references public.orders(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists inventory_events_product_idx
  on public.inventory_events(product_id, size, changed_at desc);

create index if not exists inventory_events_order_idx
  on public.inventory_events(order_id, changed_at desc);

alter table public.inventory_events enable row level security;
revoke all on table public.inventory_events from anon, authenticated;

create policy "inventory_events_no_client_access"
  on public.inventory_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.audit_inventory_stock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  if old.stock is distinct from new.stock then
    begin
      v_order_id := nullif(current_setting('marketkita.order_id', true), '')::uuid;
    exception when others then
      v_order_id := null;
    end;

    insert into public.inventory_events(
      product_size_id, product_id, size,
      old_stock, new_stock, delta, reason, order_id
    )
    values(
      new.id, new.product_id, new.size,
      old.stock, new.stock, new.stock - old.stock,
      case
        when new.stock < old.stock then 'stock_decrease'
        when new.stock > old.stock then 'stock_increase'
        else 'stock_change'
      end,
      v_order_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_inventory_stock_change() from public, anon, authenticated;

drop trigger if exists trg_audit_inventory_stock_change on public.product_sizes;
create trigger trg_audit_inventory_stock_change
after update of stock on public.product_sizes
for each row
execute function public.audit_inventory_stock_change();
