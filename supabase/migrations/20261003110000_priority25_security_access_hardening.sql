begin;

-- P25: Security & Access Hardening.
-- SECURITY DEFINER functions must never inherit a mutable search_path.
do $$
declare r record;
begin
  for r in
    select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('alter function %I.%I(%s) set search_path = ''''',r.nspname,r.proname,r.args);
    execute format('revoke execute on function %I.%I(%s) from anon',r.nspname,r.proname,r.args);
  end loop;
end $$;

-- Internal/trigger/service functions are never part of the browser RPC surface.
do $$
declare r record;
begin
  for r in
    select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and (
        p.proname in (
          'admin_audit_trigger','assert_ledger_transaction_balanced','audit_inventory_stock_change',
          'audit_order_status_change','auto_complete_delivered_orders','consume_user_voucher',
          'create_order_payouts','decrement_order_stock','finalize_order_stock','handle_new_user',
          'ledger_ensure_seller_account','ledger_order_payment_trigger','ledger_payout_trigger',
          'ledger_post_order_payment','ledger_post_payout','ledger_post_refund','ledger_refund_trigger',
          'notify_buyer_on_review_reply','notify_chat_message','notify_order_status_change',
          'notify_return_status_change','prevent_non_admin_role_change','release_expired_stock_reservations',
          'release_order_stock_reservation','release_user_voucher','release_voucher_on_unpaid_order_end',
          'reserve_order_stock','restore_order_stock','service_update_refund_request',
          'touch_chat_thread_on_message','touch_return_requests_updated_at',
          'touch_shipping_shipments_updated_at','update_order_status','validate_order_state_transition',
          'validate_shipping_delivery_proof','validate_shipping_shipment'
        )
        or p.proname like 'service_%'
        or p.proname like 'ledger_%'
        or p.proname like 'audit_%'
        or p.proname like 'touch_%'
        or p.proname like 'notify_%'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from authenticated,anon',r.nspname,r.proname,r.args);
  end loop;
end $$;

-- Address search is a controlled public UI RPC but must require authentication.
revoke execute on function public.search_address_streets(text,text,text,text,text,text,integer) from anon;
grant execute on function public.search_address_streets(text,text,text,text,text,text,integer) to authenticated;

-- This import table is service-only; authenticated/anon receive an explicit deny policy.
alter table public.address_street_import_batches enable row level security;
drop policy if exists address_street_import_batches_no_client_access on public.address_street_import_batches;
create policy address_street_import_batches_no_client_access
  on public.address_street_import_batches
  for all to anon,authenticated
  using (false)
  with check (false);

commit;