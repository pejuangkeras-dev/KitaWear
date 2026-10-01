-- Tahap B trigger fix: correct enum IN syntax for unpaid voucher release.
create or replace function public.release_voucher_on_unpaid_order_end()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if old.payment_status='pending'::public.payment_status
     and new.payment_status in ('failed'::public.payment_status,'expired'::public.payment_status)
     and new.voucher_id is not null
     and new.buyer_id is not null then
    perform public.release_user_voucher(new.voucher_id,new.buyer_id);
  end if;
  return new;
end;
$$;