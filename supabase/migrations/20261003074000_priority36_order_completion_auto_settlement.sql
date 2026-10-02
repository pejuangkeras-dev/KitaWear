-- P36 order completion auto-settlement
create or replace function public.auto_complete_delivered_orders(p_grace_days integer default 7)
returns integer language plpgsql security definer set search_path=''
as $$
declare r record; v_count integer:=0;
begin
 if p_grace_days<1 or p_grace_days>30 then raise exception 'Invalid grace period'; end if;
 for r in
   select o.id,o.order_number,o.buyer_id
   from public.orders o
   where o.status='delivered'::public.order_status
     and o.payment_status='paid'::public.payment_status
     and o.delivered_at is not null
     and o.delivered_at <= now() - make_interval(days=>p_grace_days)
     and not exists (select 1 from public.disputes d where d.order_id=o.id and d.status not in ('resolved','closed','rejected'))
   for update of o skip locked
 loop
   perform public.create_order_payouts(r.id);
   update public.orders set status='completed'::public.order_status,completed_at=coalesce(completed_at,now()),updated_at=now() where id=r.id and status='delivered'::public.order_status;
   update public.order_sellers set seller_status='completed',updated_at=now() where order_id=r.id;
   update public.seller_payouts set status='eligible' where order_id=r.id and status='pending';
   insert into public.notifications(user_id,type,title,message,link) values(r.buyer_id,'order','Pesanan selesai otomatis',format('Pesanan %s otomatis selesai setelah masa konfirmasi berakhir.',r.order_number),'?account=orders');
   v_count:=v_count+1;
 end loop;
 return v_count;
end;
$$;
revoke execute on function public.auto_complete_delivered_orders(integer) from public,anon,authenticated;