-- P29 Promotion Engine
create table if not exists public.promotion_rules (
 id uuid primary key default gen_random_uuid(),
 voucher_id uuid not null references public.vouchers(id) on delete cascade,
 scope text not null default 'global' check (scope in ('global','store','product')),
 store_id uuid references public.stores(id) on delete cascade,
 product_id uuid references public.products(id) on delete cascade,
 first_order_only boolean not null default false,
 stackable boolean not null default false,
 priority integer not null default 100 check (priority between 0 and 10000),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((scope='global' and store_id is null and product_id is null) or (scope='store' and store_id is not null and product_id is null) or (scope='product' and product_id is not null))
);
create index if not exists promotion_rules_voucher_idx on public.promotion_rules(voucher_id,active,priority);
create index if not exists promotion_rules_store_idx on public.promotion_rules(store_id,active) where scope='store';
create index if not exists promotion_rules_product_idx on public.promotion_rules(product_id,active) where scope='product';
alter table public.promotion_rules enable row level security;
drop policy if exists promotion_rules_public_active on public.promotion_rules;
create policy promotion_rules_public_active on public.promotion_rules for select to anon,authenticated using (active=true);
revoke insert,update,delete on public.promotion_rules from anon,authenticated;
grant select on public.promotion_rules to anon,authenticated;

create or replace function public.validate_promotion_for_checkout(p_voucher_id uuid,p_user_id uuid,p_subtotal bigint default 0,p_product_ids uuid[] default '{}',p_store_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.vouchers%rowtype; c public.user_vouchers%rowtype; discount bigint:=0; eligible boolean:=false; has_first_order boolean:=false;
begin
 if p_voucher_id is null or p_user_id is null then return jsonb_build_object('valid',false,'code','VOUCHER_INVALID'); end if;
 select * into v from public.vouchers where id=p_voucher_id;
 if not found or not v.active or v.starts_at>now() or (v.expires_at is not null and v.expires_at<=now()) or (v.usage_limit is not null and v.used_count>=v.usage_limit) then return jsonb_build_object('valid',false,'code','VOUCHER_UNAVAILABLE'); end if;
 select * into c from public.user_vouchers where voucher_id=p_voucher_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('valid',false,'code','VOUCHER_NOT_CLAIMED'); end if;
 if c.used_at is not null then return jsonb_build_object('valid',false,'code','VOUCHER_ALREADY_USED'); end if;
 if coalesce(p_subtotal,0)<v.min_order_amount then return jsonb_build_object('valid',false,'code','MIN_ORDER_NOT_MET','minimum',v.min_order_amount); end if;
 select not exists(select 1 from public.orders where buyer_id=p_user_id and status<>'cancelled') into has_first_order;
 select exists(select 1 from public.promotion_rules pr where pr.voucher_id=p_voucher_id and pr.active=true and (pr.scope='global' or (pr.scope='store' and pr.store_id=any(coalesce(p_store_ids,'{}'))) or (pr.scope='product' and pr.product_id=any(coalesce(p_product_ids,'{}'))))) or not exists(select 1 from public.promotion_rules pr where pr.voucher_id=p_voucher_id and pr.active=true) into eligible;
 if exists(select 1 from public.promotion_rules pr where pr.voucher_id=p_voucher_id and pr.active=true and pr.first_order_only=true) and not has_first_order then return jsonb_build_object('valid',false,'code','FIRST_ORDER_ONLY'); end if;
 if not eligible then return jsonb_build_object('valid',false,'code','PROMOTION_NOT_ELIGIBLE'); end if;
 if v.discount_type='percent' then discount:=floor(coalesce(p_subtotal,0)*v.discount_value/100); else discount:=v.discount_value; end if;
 if v.max_discount is not null then discount:=least(discount,v.max_discount); end if;
 discount:=greatest(0,least(discount,coalesce(p_subtotal,0)));
 return jsonb_build_object('valid',true,'voucher_id',v.id,'code',v.code,'discount_amount',discount,'subtotal',coalesce(p_subtotal,0),'total_after_discount',greatest(0,coalesce(p_subtotal,0)-discount));
end $$;
revoke execute on function public.validate_promotion_for_checkout(uuid,uuid,bigint,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.validate_promotion_for_checkout(uuid,uuid,bigint,uuid[],uuid[]) to service_role;
