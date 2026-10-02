create or replace function public.ledger_post_refund(p_refund_request_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 r record; source_tx uuid; t_id uuid; cash_id uuid; refund_id uuid;
 original_cash bigint; ratio numeric; e record; amt bigint; seller_available bigint;
 debits bigint; credits bigint;
begin
 select * into r from public.refund_requests where id=p_refund_request_id for update;
 if not found then raise exception 'Refund request not found'; end if;
 if r.status<>'succeeded' then raise exception 'Refund is not succeeded'; end if;
 select id into t_id from public.ledger_transactions where transaction_key='refund:'||p_refund_request_id::text;
 if t_id is not null then return t_id; end if;
 select id into source_tx from public.ledger_transactions where transaction_key='order_payment:'||r.order_id::text;
 if source_tx is null then raise exception 'Original order payment ledger not found'; end if;
 select sum(le.amount) into original_cash from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id
 where le.transaction_id=source_tx and la.account_key='system:cash' and le.direction='debit';
 if coalesce(original_cash,0)<=0 then raise exception 'Original cash ledger is invalid'; end if;
 if r.amount>original_cash then raise exception 'Refund exceeds original payment'; end if;
 select id into cash_id from public.ledger_accounts where account_key='system:cash';
 select id into refund_id from public.ledger_accounts where account_key='system:refund_expense';
 insert into public.ledger_transactions(transaction_key,transaction_type,order_id,amount,currency,source_type,source_id,description)
 values('refund:'||p_refund_request_id::text,'refund',r.order_id,r.amount,'IDR','refund_request',p_refund_request_id,'Customer refund')
 returning id into t_id;
 ratio:=r.amount::numeric/original_cash::numeric;
 for e in select le.account_id,le.direction,le.amount,la.account_key from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id
 where le.transaction_id=source_tx order by case when la.account_key='system:cash' then 0 else 1 end,le.id loop
   if e.account_key='system:cash' then amt:=r.amount; else amt:=floor(e.amount*ratio); end if;
   if amt<=0 then continue; end if;
   if e.account_key like 'seller:%' and e.direction='credit' then
     select coalesce(sum(case when le2.direction='credit' then le2.amount else -le2.amount end),0) into seller_available
     from public.ledger_entries le2 where le2.account_id=e.account_id;
     if seller_available>0 then
       insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo)
       values(t_id,e.account_id,'debit',least(amt,seller_available),'Refund reversal - seller balance');
     end if;
     if amt>greatest(seller_available,0) then
       insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo)
       values(t_id,refund_id,'debit',amt-greatest(seller_available,0),'Refund expense - seller already settled');
     end if;
   else
     insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo)
     values(t_id,e.account_id,case when e.direction='debit' then 'credit' else 'debit' end,amt,'Refund reversal');
   end if;
 end loop;
 select coalesce(sum(amount) filter(where direction='debit'),0),coalesce(sum(amount) filter(where direction='credit'),0) into debits,credits from public.ledger_entries where transaction_id=t_id;
 if debits<credits then insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,refund_id,'debit',credits-debits,'Refund rounding adjustment');
 elsif credits<debits then insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,refund_id,'credit',debits-credits,'Refund rounding adjustment'); end if;
 return t_id;
end;
$$;
revoke execute on function public.ledger_post_refund(uuid) from public,anon,authenticated;