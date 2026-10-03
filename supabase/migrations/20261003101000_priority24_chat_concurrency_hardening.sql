begin;

alter table public.chat_messages drop constraint if exists chat_messages_body_length_check;
alter table public.chat_messages add constraint chat_messages_body_length_check check (char_length(trim(body)) between 1 and 2000);

create or replace function public.open_chat_thread(p_store_id uuid)
returns public.chat_threads
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  s public.stores;
  t public.chat_threads;
begin
  if uid is null then raise exception 'Login diperlukan.'; end if;
  select * into s from public.stores where id=p_store_id and status='active';
  if not found then raise exception 'Toko tidak tersedia untuk chat.'; end if;
  if s.owner_id is null or s.owner_id=uid then raise exception 'Chat seller tidak tersedia.'; end if;

  select * into t from public.chat_threads
  where buyer_id=uid and store_id=p_store_id
  limit 1 for update;
  if found then return t; end if;

  begin
    insert into public.chat_threads(buyer_id,seller_id,store_id,updated_at)
    values(uid,s.owner_id,p_store_id,now())
    returning * into t;
    return t;
  exception when unique_violation then
    select * into t from public.chat_threads
    where buyer_id=uid and store_id=p_store_id
    limit 1;
    if found then return t; end if;
    raise;
  end;
end
$function$;

commit;
