create table if not exists public.buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Rumah',
  recipient_name text not null,
  phone text not null,
  address_line text not null,
  city text not null,
  province text not null,
  postal_code text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyer_addresses_user_id_idx
  on public.buyer_addresses(user_id);

create unique index if not exists buyer_addresses_one_default_per_user
  on public.buyer_addresses(user_id)
  where is_default = true;

alter table public.buyer_addresses enable row level security;

drop policy if exists "buyer_addresses_select_own" on public.buyer_addresses;
create policy "buyer_addresses_select_own"
  on public.buyer_addresses
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "buyer_addresses_insert_own" on public.buyer_addresses;
create policy "buyer_addresses_insert_own"
  on public.buyer_addresses
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "buyer_addresses_update_own" on public.buyer_addresses;
create policy "buyer_addresses_update_own"
  on public.buyer_addresses
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "buyer_addresses_delete_own" on public.buyer_addresses;
create policy "buyer_addresses_delete_own"
  on public.buyer_addresses
  for delete to authenticated
  using (auth.uid() = user_id);

drop trigger if exists buyer_addresses_set_updated_at on public.buyer_addresses;
create trigger buyer_addresses_set_updated_at
before update on public.buyer_addresses
for each row execute function public.set_updated_at();

revoke all on public.buyer_addresses from anon;
grant select, insert, update, delete on public.buyer_addresses to authenticated;
