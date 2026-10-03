begin;

create unique index if not exists chat_threads_buyer_store_unique
  on public.chat_threads(buyer_id,store_id);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

revoke execute on function public.open_chat_thread(uuid) from anon;
revoke execute on function public.mark_chat_messages_read(uuid) from anon;

alter function public.open_chat_thread(uuid) set search_path = '';
alter function public.mark_chat_messages_read(uuid) set search_path = '';

create table if not exists public.store_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,store_id)
);

alter table public.store_follows enable row level security;

drop policy if exists store_follows_select_own on public.store_follows;
drop policy if exists store_follows_insert_own on public.store_follows;
drop policy if exists store_follows_delete_own on public.store_follows;

create policy store_follows_select_own on public.store_follows
  for select to authenticated
  using (user_id=(select auth.uid()));

create policy store_follows_insert_own on public.store_follows
  for insert to authenticated
  with check (user_id=(select auth.uid()));

create policy store_follows_delete_own on public.store_follows
  for delete to authenticated
  using (user_id=(select auth.uid()));

create index if not exists store_follows_store_idx on public.store_follows(store_id);
create index if not exists chat_messages_thread_created_idx on public.chat_messages(thread_id,created_at desc);

grant select,insert,delete on public.store_follows to authenticated;

commit;
