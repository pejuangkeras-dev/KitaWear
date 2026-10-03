create table if not exists public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  code text unique,
  description text,
  promotion_type text not null check (promotion_type in ('percent_discount','fixed_discount','free_shipping','cashback','buy_x_get_y','bundle_discount','flash_sale')),
  scope text not null default 'global' check (scope in ('global','store','product','category')),
  store_id uuid references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category text,
  config jsonb not null default '{}'::jsonb,
  priority integer not null default 100 check (priority between 0 and 10000),
  stackable boolean not null default false,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  per_user_limit integer not null default 1 check (per_user_limit >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at),
  check ((scope='global' and store_id is null and product_id is null and category is null) or (scope='store' and store_id is not null and product_id is null and category is null) or (scope='product' and product_id is not null and store_id is null and category is null) or (scope='category' and category is not null and length(trim(category)) > 0 and store_id is null and product_id is null))
);
create index if not exists idx_promotion_campaigns_active_window on public.promotion_campaigns(active, starts_at, expires_at, priority);
create index if not exists idx_promotion_campaigns_store on public.promotion_campaigns(store_id, active);
create index if not exists idx_promotion_campaigns_product on public.promotion_campaigns(product_id, active);
create index if not exists idx_promotion_campaigns_category on public.promotion_campaigns(category, active);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  shipping_discount_amount bigint not null default 0 check (shipping_discount_amount >= 0),
  cashback_amount bigint not null default 0 check (cashback_amount >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(campaign_id, order_id)
);
create index if not exists idx_promotion_redemptions_user_campaign on public.promotion_redemptions(user_id, campaign_id, created_at desc);
create index if not exists idx_promotion_redemptions_order on public.promotion_redemptions(order_id);
alter table public.promotion_campaigns enable row level security;
alter table public.promotion_redemptions enable row level security;
drop policy if exists promotion_campaigns_public_read on public.promotion_campaigns;
create policy promotion_campaigns_public_read on public.promotion_campaigns for select to anon, authenticated using (active=true and starts_at<=now() and (expires_at is null or expires_at>now()));
drop policy if exists promotion_redemptions_no_client_access on public.promotion_redemptions;
create policy promotion_redemptions_no_client_access on public.promotion_redemptions for all to anon, authenticated using (false) with check (false);

create or replace function public.evaluate_promotion_campaigns(p_user_id uuid,p_items jsonb,p_subtotal bigint,p_shipping_fee bigint,p_voucher_id uuid default null,p_campaign_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare c record; i record; item_subtotal bigint; campaign_discount bigint; campaign_shipping bigint; campaign_cashback bigint; min_order bigint; max_discount bigint; amount bigint; pct numeric; buy_qty integer; get_qty integer; discount_pct numeric; required_products jsonb; ok boolean; v_campaigns jsonb:='[]'::jsonb; v_selected jsonb:='[]'::jsonb; v_selected_ids uuid[]:='{}'; v_discount bigint:=0; v_shipping bigint:=0; v_cashback bigint:=0; v_has_nonstackable boolean:=false; v_voucher_stackable boolean:=false; v_user_count integer; v_selected_count integer:=0;
begin
 if coalesce(p_subtotal,0)<0 or coalesce(p_shipping_fee,0)<0 then return jsonb_build_object('valid',false,'code','PROMOTION_INVALID_TOTAL'); end if;
 if p_voucher_id is not null then
   select coalesce(bool_and(pr.stackable),false) into v_voucher_stackable from public.promotion_rules pr where pr.voucher_id=p_voucher_id and pr.active=true;
   if not exists(select 1 from public.promotion_rules pr where pr.voucher_id=p_voucher_id and pr.active=true) then v_voucher_stackable:=false; end if;
 end if;
 for c in select pc.* from public.promotion_campaigns pc where pc.active=true and pc.starts_at<=now() and (pc.expires_at is null or pc.expires_at>now()) and (pc.usage_limit is null or pc.used_count<pc.usage_limit) and (p_campaign_ids is null or pc.id=any(p_campaign_ids)) order by pc.priority asc,pc.created_at asc,pc.id asc loop
   campaign_discount:=0; campaign_shipping:=0; campaign_cashback:=0; item_subtotal:=0; ok:=false;
   if c.scope='global' then select coalesce(sum((x->>'unit_price')::bigint*(x->>'quantity')::integer),0) into item_subtotal from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x; ok:=item_subtotal>0;
   elsif c.scope='store' then select coalesce(sum((x->>'unit_price')::bigint*(x->>'quantity')::integer),0) into item_subtotal from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x where (x->>'store_id')::uuid=c.store_id; ok:=item_subtotal>0;
   elsif c.scope='product' then select coalesce(sum((x->>'unit_price')::bigint*(x->>'quantity')::integer),0) into item_subtotal from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x where (x->>'product_id')::uuid=c.product_id; ok:=item_subtotal>0;
   else select coalesce(sum((x->>'unit_price')::bigint*(x->>'quantity')::integer),0) into item_subtotal from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x join public.products p on p.id=(x->>'product_id')::uuid where lower(trim(coalesce(p.category,'')))=lower(trim(c.category)); ok:=item_subtotal>0;
   end if;
   min_order:=greatest(0,coalesce((c.config->>'min_order_amount')::bigint,0)); if not ok or coalesce(p_subtotal,0)<min_order then continue; end if;
   if p_user_id is not null and c.per_user_limit>0 then select count(*) into v_user_count from public.promotion_redemptions prr where prr.campaign_id=c.id and prr.user_id=p_user_id; if v_user_count>=c.per_user_limit then continue; end if; end if;
   if p_voucher_id is not null and not v_voucher_stackable then continue; end if;
   if v_selected_count>0 and (v_has_nonstackable or not c.stackable) then continue; end if;
   case c.promotion_type
     when 'percent_discount','flash_sale' then pct:=greatest(0,least(100,coalesce((c.config->>'percent')::numeric,(c.config->>'discount_percent')::numeric,0))); campaign_discount:=floor(item_subtotal*pct/100); max_discount:=(c.config->>'max_discount')::bigint; if max_discount is not null then campaign_discount:=least(campaign_discount,greatest(0,max_discount)); end if;
     when 'fixed_discount' then amount:=greatest(0,coalesce((c.config->>'amount')::bigint,0)); campaign_discount:=least(amount,item_subtotal);
     when 'free_shipping' then max_discount:=coalesce((c.config->>'max_discount')::bigint,p_shipping_fee); campaign_shipping:=least(greatest(0,max_discount),greatest(0,p_shipping_fee));
     when 'cashback' then if lower(coalesce(c.config->>'mode','fixed'))='percent' then pct:=greatest(0,least(100,coalesce((c.config->>'percent')::numeric,0))); campaign_cashback:=floor(item_subtotal*pct/100); else campaign_cashback:=greatest(0,coalesce((c.config->>'amount')::bigint,0)); end if; campaign_cashback:=least(campaign_cashback,coalesce((c.config->>'max_cashback')::bigint,campaign_cashback));
     when 'buy_x_get_y' then buy_qty:=greatest(1,coalesce((c.config->>'buy_qty')::integer,1)); get_qty:=greatest(1,coalesce((c.config->>'get_qty')::integer,1)); discount_pct:=greatest(0,least(100,coalesce((c.config->>'discount_percent')::numeric,100))); for i in select (x->>'product_id')::uuid product_id,(x->>'quantity')::integer quantity,(x->>'unit_price')::bigint unit_price from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x loop if c.scope='product' and i.product_id=c.product_id and i.quantity>=buy_qty+get_qty then campaign_discount:=campaign_discount+floor(floor(i.quantity/(buy_qty+get_qty))*get_qty*i.unit_price*discount_pct/100); end if; end loop;
     when 'bundle_discount' then required_products:=coalesce(c.config->'product_ids','[]'::jsonb); if jsonb_array_length(required_products)=0 then continue; end if; ok:=true; for i in select value as product_id from jsonb_array_elements_text(required_products) loop if not exists(select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x where (x->>'product_id')=i.product_id) then ok:=false; exit; end if; end loop; if ok then pct:=greatest(0,least(100,coalesce((c.config->>'percent')::numeric,0))); campaign_discount:=floor(item_subtotal*pct/100); amount:=coalesce((c.config->>'amount')::bigint,0); if amount>0 then campaign_discount:=greatest(campaign_discount,least(amount,item_subtotal)); end if; else continue; end if;
   end case;
   if campaign_discount=0 and campaign_shipping=0 and campaign_cashback=0 then continue; end if;
   v_campaigns:=v_campaigns||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'promotion_type',c.promotion_type,'priority',c.priority,'stackable',c.stackable,'discount_amount',campaign_discount,'shipping_discount_amount',campaign_shipping,'cashback_amount',campaign_cashback));
   if v_selected_count=0 or c.stackable then
     v_selected:=v_selected||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'promotion_type',c.promotion_type,'discount_amount',campaign_discount,'shipping_discount_amount',campaign_shipping,'cashback_amount',campaign_cashback));
     v_selected_ids:=array_append(v_selected_ids,c.id); v_discount:=v_discount+campaign_discount; v_shipping:=v_shipping+campaign_shipping; v_cashback:=v_cashback+campaign_cashback; v_selected_count:=v_selected_count+1; if not c.stackable then v_has_nonstackable:=true; end if;
   end if;
 end loop;
 v_discount:=least(v_discount,coalesce(p_subtotal,0)); v_shipping:=least(v_shipping,coalesce(p_shipping_fee,0));
 return jsonb_build_object('valid',true,'eligible_campaigns',v_campaigns,'selected_campaigns',v_selected,'campaign_ids',to_jsonb(v_selected_ids),'discount_amount',v_discount,'shipping_discount_amount',v_shipping,'cashback_amount',v_cashback,'payable_reduction',v_discount+v_shipping);
end;
$$;

create or replace function public.redeem_promotion_campaigns(p_order_id uuid,p_user_id uuid,p_campaign_ids uuid[],p_discount jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare cid uuid; c public.promotion_campaigns%rowtype; per_user integer; d bigint:=0; s bigint:=0; cb bigint:=0; x jsonb;
begin
 if p_order_id is null or p_user_id is null then raise exception 'PROMOTION_INVALID'; end if;
 if p_campaign_ids is null or cardinality(p_campaign_ids)=0 then return jsonb_build_object('ok',true,'count',0); end if;
 foreach cid in array p_campaign_ids loop
   select * into c from public.promotion_campaigns where id=cid for update;
   if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
   if not c.active or c.starts_at>now() or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'PROMOTION_UNAVAILABLE'; end if;
   if c.usage_limit is not null and c.used_count>=c.usage_limit then raise exception 'PROMOTION_QUOTA_EXCEEDED'; end if;
   if c.per_user_limit>0 then select count(*) into per_user from public.promotion_redemptions where campaign_id=cid and user_id=p_user_id; if per_user>=c.per_user_limit then raise exception 'PROMOTION_USER_LIMIT'; end if; end if;
   x:=coalesce((select e from jsonb_array_elements(coalesce(p_discount->'campaigns','[]'::jsonb)) e where (e->>'id')=cid::text limit 1),'{}'::jsonb);
   d:=coalesce((x->>'discount_amount')::bigint,0); s:=coalesce((x->>'shipping_discount_amount')::bigint,0); cb:=coalesce((x->>'cashback_amount')::bigint,0);
   insert into public.promotion_redemptions(campaign_id,order_id,user_id,discount_amount,shipping_discount_amount,cashback_amount,metadata) values(cid,p_order_id,p_user_id,d,s,cb,jsonb_build_object('source','checkout'));
   update public.promotion_campaigns set used_count=used_count+1,updated_at=now() where id=cid;
 end loop;
 return jsonb_build_object('ok',true,'count',cardinality(p_campaign_ids));
end;
$$;

create or replace function public.release_promotion_campaigns(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare r record; n integer:=0;
begin
 for r in select * from public.promotion_redemptions where order_id=p_order_id for update loop
   update public.promotion_campaigns set used_count=greatest(0,used_count-1),updated_at=now() where id=r.campaign_id;
   delete from public.promotion_redemptions where id=r.id; n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'count',n);
end;
$$;
revoke execute on function public.evaluate_promotion_campaigns(uuid,jsonb,bigint,bigint,uuid,uuid[]) from public,anon,authenticated;
revoke execute on function public.redeem_promotion_campaigns(uuid,uuid,uuid[],jsonb) from public,anon,authenticated;
revoke execute on function public.release_promotion_campaigns(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_promotion_campaigns(uuid,jsonb,bigint,bigint,uuid,uuid[]) to service_role;
grant execute on function public.redeem_promotion_campaigns(uuid,uuid,uuid[],jsonb) to service_role;
grant execute on function public.release_promotion_campaigns(uuid) to service_role;


-- G4 API hardening: campaigns are served only through authenticated Cloudflare APIs.
revoke all on table public.promotion_campaigns from anon, authenticated;
revoke all on table public.promotion_redemptions from anon, authenticated;
drop policy if exists promotion_campaigns_public_read on public.promotion_campaigns;
