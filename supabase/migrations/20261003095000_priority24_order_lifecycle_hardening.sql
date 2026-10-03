-- P24: order lifecycle hardening
begin;

alter table public.orders enable row level security;
alter table public.order_sellers enable row level security;
alter table public.seller_payout_requests enable row level security;
alter table public.seller_payouts enable row level security;
alter table public.return_requests enable row level security;
alter table public.disputes enable row level security;
alter table public.refund_requests enable row level security;

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_sellers from anon, authenticated;
revoke insert, update, delete on public.seller_payout_requests from anon, authenticated;
revoke insert, update, delete on public.seller_payouts from anon, authenticated;
revoke insert, update, delete on public.return_requests from anon, authenticated;
revoke insert, update, delete on public.disputes from anon, authenticated;
revoke insert, update, delete on public.refund_requests from anon, authenticated;

drop policy if exists disputes_buyer_insert on public.disputes;

revoke execute on function public.buyer_confirm_order_received(uuid) from anon;
revoke execute on function public.buyer_create_dispute(uuid,text,text) from anon;
revoke execute on function public.request_return(uuid,text,text,text,jsonb) from anon;
revoke execute on function public.seller_update_order_status(uuid,text) from anon;
revoke execute on function public.seller_request_payout(integer,text) from anon;
revoke execute on function public.admin_review_payout_request(uuid,text,text) from anon;
revoke execute on function public.admin_resolve_return(uuid,text,integer,text) from anon;
revoke execute on function public.admin_resolve_dispute(uuid,text,text) from anon;
revoke execute on function public.admin_begin_dispute_refund(uuid,text) from anon;

alter function public.buyer_create_dispute(uuid,text,text) set search_path = '';

commit;
