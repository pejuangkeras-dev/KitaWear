create table if not exists public.cs_threads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  assigned_admin_id uuid null references public.profiles(id) on delete set null,
  subject text not null default 'Bantuan Customer Service',
  status text not null default 'open' check (status in ('open','pending','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.cs_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.cs_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer','admin')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz null
);
create index if not exists cs_threads_customer_idx on public.cs_threads(customer_id,last_message_at desc);
create index if not exists cs_threads_status_idx on public.cs_threads(status,last_message_at desc);
create index if not exists cs_messages_thread_idx on public.cs_messages(thread_id,created_at);
alter table public.cs_threads enable row level security;
alter table public.cs_messages enable row level security;
create or replace function public.cs_touch_thread()
returns trigger language plpgsql as $$
begin
  update public.cs_threads set updated_at=now(),last_message_at=new.created_at where id=new.thread_id;
  return new;
end $$;
drop trigger if exists cs_messages_touch_thread on public.cs_messages;
create trigger cs_messages_touch_thread after insert on public.cs_messages for each row execute function public.cs_touch_thread();
create or replace function public.cs_customer_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  select customer_id into cid from public.cs_threads where id=new.thread_id;
  if new.sender_role='admin' and cid is not null then
    insert into public.notifications(user_id,type,title,message,link)
    values(cid,'customer_service','Customer Service membalas','Ada balasan baru dari Customer Service MarketKita.','/?cs=1');
  end if;
  return new;
end $$;
drop trigger if exists cs_message_customer_notification on public.cs_messages;
create trigger cs_message_customer_notification after insert on public.cs_messages for each row execute function public.cs_customer_notification();