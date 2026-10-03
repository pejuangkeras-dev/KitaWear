create or replace function public.mk_loyalty_tier(p_lifetime_earned bigint)
returns text language sql immutable set search_path=public as $$
select case when coalesce(p_lifetime_earned,0)>=100000 then 'platinum' when coalesce(p_lifetime_earned,0)>=50000 then 'gold' when coalesce(p_lifetime_earned,0)>=10000 then 'silver' else 'member' end
$$;