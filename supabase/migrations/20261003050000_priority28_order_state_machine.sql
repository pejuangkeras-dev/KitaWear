create or replace function public.validate_order_state_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean := false;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  case old.status
    when 'pending_payment'::public.order_status then
      v_allowed := new.status in ('paid'::public.order_status,'cancelled'::public.order_status);
    when 'paid'::public.order_status then
      v_allowed := new.status in ('processing'::public.order_status,'cancelled'::public.order_status,'disputed'::public.order_status,'refunded'::public.order_status);
    when 'processing'::public.order_status then
      v_allowed := new.status in ('shipped'::public.order_status,'cancelled'::public.order_status,'disputed'::public.order_status,'refunded'::public.order_status);
    when 'shipped'::public.order_status then
      v_allowed := new.status in ('delivered'::public.order_status,'disputed'::public.order_status,'refunded'::public.order_status);
    when 'delivered'::public.order_status then
      v_allowed := new.status in ('completed'::public.order_status,'disputed'::public.order_status,'refunded'::public.order_status);
    when 'completed'::public.order_status then
      v_allowed := new.status in ('disputed'::public.order_status,'refunded'::public.order_status);
    when 'disputed'::public.order_status then
      v_allowed := new.status in ('refunded'::public.order_status);
    when 'cancelled'::public.order_status then
      v_allowed := false;
    when 'refunded'::public.order_status then
      v_allowed := false;
    else
      v_allowed := false;
  end case;

  if not v_allowed then
    raise exception 'Perpindahan status order tidak valid: % -> %.', old.status, new.status;
  end if;

  if new.status in (
    'paid'::public.order_status,'processing'::public.order_status,
    'shipped'::public.order_status,'delivered'::public.order_status,
    'completed'::public.order_status,'disputed'::public.order_status
  ) and new.payment_status <> 'paid'::public.payment_status then
    raise exception 'Status % membutuhkan payment_status=paid.', new.status;
  end if;

  if new.status='refunded'::public.order_status
     and new.payment_status <> 'refunded'::public.payment_status then
    raise exception 'Status refunded membutuhkan payment_status=refunded.';
  end if;

  if new.status='pending_payment'::public.order_status
     and new.payment_status <> 'pending'::public.payment_status then
    raise exception 'Status pending_payment membutuhkan payment_status=pending.';
  end if;

  if new.status='cancelled'::public.order_status
     and new.payment_status not in (
       'pending'::public.payment_status,
       'failed'::public.payment_status,
       'expired'::public.payment_status
     ) then
    raise exception 'Order paid tidak dapat dibatalkan melalui state machine.';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_order_state_transition() from public, anon, authenticated;

drop trigger if exists trg_validate_order_state_transition on public.orders;
create trigger trg_validate_order_state_transition
before update of status on public.orders
for each row
execute function public.validate_order_state_transition();
