drop trigger if exists trg_g7_chat_message_notify on public.chat_messages;
create or replace function public.notify_chat_message() returns trigger language plpgsql security definer set search_path=public as $$
declare t public.chat_threads; receiver uuid; store_name text; enabled boolean;
begin
 select * into t from public.chat_threads where id=new.thread_id;
 if t.buyer_id is null or t.seller_id is null then return new; end if;
 receiver:=case when new.sender_id=t.buyer_id then t.seller_id else t.buyer_id end;
 enabled:=coalesce((select chat_messages from public.notification_preferences where user_id=receiver),true);
 if enabled then
   select name into store_name from public.stores where id=t.store_id;
   insert into public.notifications(user_id,type,title,message,link) values(receiver,'chat','Pesan baru dari '||coalesce(store_name,'MarketKita'),left(new.body,180),'#account-messages');
 end if;
 update public.chat_threads set updated_at=now() where id=new.thread_id;
 return new;
end $$;