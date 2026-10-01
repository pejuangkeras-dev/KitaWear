-- Reconcile seller balance summary.
-- Available is the seller's eligible payout ledger.
-- Outstanding payout requests are pending + approved.
-- Reconciliation compares cumulative paid payout requests with paid payout ledger.

create or replace function public.seller_balance_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_eligible bigint := 0;
  v_pending_ledger bigint := 0;
  v_paid_ledger bigint := 0;
  v_refunded_ledger bigint := 0;
  v_pending_requests bigint := 0;
  v_approved_requests bigint := 0;
  v_paid_requests bigint := 0;
  v_rejected_requests bigint := 0;
  v_total_ledger bigint := 0;
  v_outstanding_requests bigint := 0;
  v_discrepancy bigint := 0;
begin
  if v_user is null then raise exception 'LOGIN_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then
    raise exception 'SELLER_REQUIRED';
  end if;

  select
    coalesce(sum(net_amount) filter(where status='eligible'),0),
    coalesce(sum(net_amount) filter(where status='pending'),0),
    coalesce(sum(net_amount) filter(where status='paid'),0),
    coalesce(sum(net_amount) filter(where status='refunded'),0),
    coalesce(sum(net_amount),0)
  into v_eligible,v_pending_ledger,v_paid_ledger,v_refunded_ledger,v_total_ledger
  from public.seller_payouts
  where seller_id=v_user;

  select
    coalesce(sum(amount) filter(where status='pending'),0),
    coalesce(sum(amount) filter(where status='approved'),0),
    coalesce(sum(amount) filter(where status='paid'),0),
    coalesce(sum(amount) filter(where status='rejected'),0)
  into v_pending_requests,v_approved_requests,v_paid_requests,v_rejected_requests
  from public.seller_payout_requests
  where seller_id=v_user;

  v_outstanding_requests := v_pending_requests + v_approved_requests;
  v_discrepancy := v_paid_requests - v_paid_ledger;

  return jsonb_build_object(
    'available',v_eligible,
    'pending',v_pending_requests,
    'paid',v_paid_ledger,
    'requested',v_outstanding_requests,
    'ledger_eligible',v_eligible,
    'ledger_pending',v_pending_ledger,
    'ledger_paid',v_paid_ledger,
    'ledger_refunded',v_refunded_ledger,
    'ledger_total',v_total_ledger,
    'requests_pending',v_pending_requests,
    'requests_approved',v_approved_requests,
    'requests_paid',v_paid_requests,
    'requests_rejected',v_rejected_requests,
    'outstanding_requests',v_outstanding_requests,
    'reconciliation_discrepancy',v_discrepancy,
    'reconciled',v_discrepancy=0
  );
end;
$function$;