-- Phase 2: Marketplace chat hardening
-- Existing chat_threads/chat_messages tables are preserved.
alter publication supabase_realtime add table public.chat_threads;
alter publication supabase_realtime add table public.chat_messages;

drop policy if exists chat_messages_mark_read on public.chat_messages;
create policy chat_messages_mark_read
on public.chat_messages
for update to authenticated
using (
  exists (
    select 1 from public.chat_threads t
    where t.id=chat_messages.thread_id
      and (t.buyer_id=auth.uid() or t.seller_id=auth.uid())
  )
)
with check (
  exists (
    select 1 from public.chat_threads t
    where t.id=chat_messages.thread_id
      and (t.buyer_id=auth.uid() or t.seller_id=auth.uid())
  )
);
