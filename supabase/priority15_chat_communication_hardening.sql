-- MarketKita P15: Chat & Customer Communication hardening

create unique index if not exists chat_threads_buyer_store_unique_idx
on public.chat_threads(buyer_id,store_id);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

revoke insert,update,delete on public.chat_threads from anon,authenticated;
revoke update,delete on public.chat_messages from anon,authenticated;
grant select on public.chat_threads,public.chat_messages to authenticated;
grant insert on public.chat_messages to authenticated;

drop policy if exists chat_threads_insert_buyer on public.chat_threads;

drop policy if exists chat_messages_mark_read on public.chat_messages;
create policy chat_messages_mark_read on public.chat_messages
for update to authenticated
using (false)
with check (false);

create or replace function public.open_chat_thread(p_store_id uuid)
returns public.chat_threads
language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); s public.stores; t public.chat_threads;
begin
 if uid is null then raise exception 'Login diperlukan.'; end if;
 select * into s from public.stores where id=p_store_id and status='active';
 if not found then raise exception 'Toko tidak tersedia untuk chat.'; end if;
 if s.owner_id is null or s.owner_id=uid then raise exception 'Chat seller tidak tersedia.'; end if;
 select * into t from public.chat_threads where buyer_id=uid and store_id=p_store_id limit 1 for update;
 if found then return t; end if;
 insert into public.chat_threads(buyer_id,seller_id,store_id,updated_at)
 values(uid,s.owner_id,p_store_id,now()) returning * into t;
 return t;
end $$;

create or replace function public.mark_chat_messages_read(p_thread_id uuid)
returns integer
language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); n integer;
begin
 if uid is null then raise exception 'Login diperlukan.'; end if;
 if not exists(select 1 from public.chat_threads where id=p_thread_id and (buyer_id=uid or seller_id=uid)) then
   raise exception 'Akses ditolak.';
 end if;
 update public.chat_messages set read_at=coalesce(read_at,now())
 where thread_id=p_thread_id and sender_id<>uid and read_at is null;
 get diagnostics n=row_count;
 return n;
end $$;

revoke execute on function public.open_chat_thread(uuid) from public,anon;
grant execute on function public.open_chat_thread(uuid) to authenticated,service_role;
revoke execute on function public.mark_chat_messages_read(uuid) from public,anon;
grant execute on function public.mark_chat_messages_read(uuid) to authenticated,service_role;

create or replace function public.touch_chat_thread_on_message()
returns trigger language plpgsql security definer set search_path=public
as $$
begin update public.chat_threads set updated_at=now() where id=new.thread_id; return new; end $$;
revoke execute on function public.touch_chat_thread_on_message() from public,anon,authenticated;
grant execute on function public.touch_chat_thread_on_message() to service_role;
drop trigger if exists trg_chat_thread_updated_at on public.chat_messages;
create trigger trg_chat_thread_updated_at after insert on public.chat_messages
for each row execute function public.touch_chat_thread_on_message();

do $ begin
 if not exists(select 1 from pg_constraint where conname='chat_messages_body_length_check') then
   alter table public.chat_messages add constraint chat_messages_body_length_check
   check(char_length(trim(body)) between 1 and 2000);
 end if;
end $;

create index if not exists chat_messages_thread_created_idx on public.chat_messages(thread_id,created_at desc);
create index if not exists chat_threads_seller_updated_idx on public.chat_threads(seller_id,updated_at desc);

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
   alter publication supabase_realtime add table public.chat_messages;
 end if;
end $$;