-- Historical audit backfill for the already-verified normal seller payout.
-- This does not change payout balances or status.
insert into public.seller_payout_audit(
  payout_request_id,seller_id,admin_id,action,previous_status,new_status,amount,admin_note,created_at
)
select
  id,seller_id,null,'paid','approved','paid',amount,
  'Historical backfill: payout was already paid before audit trail was deployed.',
  paid_at
from public.seller_payout_requests
where id='976ff02e-afd6-4004-8248-76ee10a95e3f'
  and status='paid'
  and paid_at is not null
on conflict (payout_request_id,action) do nothing;