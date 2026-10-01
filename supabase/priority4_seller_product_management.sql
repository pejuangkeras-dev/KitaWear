-- Priority 4 seller product management hardening
alter table public.products drop constraint if exists products_name_length_check, drop constraint if exists products_price_check, drop constraint if exists products_weight_check;
alter table public.products add constraint products_name_length_check check (char_length(trim(name)) between 2 and 160), add constraint products_price_check check (price > 0), add constraint products_weight_check check (weight_gram > 0 and weight_gram <= 100000);
alter table public.product_sizes drop constraint if exists product_sizes_name_check, drop constraint if exists product_sizes_stock_check, drop constraint if exists product_sizes_reserved_check;
alter table public.product_sizes add constraint product_sizes_name_check check (char_length(trim(size)) between 1 and 40), add constraint product_sizes_stock_check check (stock >= 0), add constraint product_sizes_reserved_check check (reserved_stock >= 0 and reserved_stock <= stock);
create unique index if not exists product_sizes_product_size_unique on public.product_sizes(product_id,lower(trim(size)));
create index if not exists products_store_status_idx on public.products(store_id,status);
create index if not exists product_sizes_product_id_idx on public.product_sizes(product_id);
drop policy if exists "KitaWear product images select" on storage.objects;
create policy "KitaWear product images select" on storage.objects for select to authenticated using (bucket_id='product-images' and ((storage.foldername(name))[1]=(auth.uid())::text or public.is_admin()));