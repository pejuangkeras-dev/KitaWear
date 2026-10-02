create or replace function public.consume_user_voucher(p_voucher_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_voucher record; v_claim record;
begin
 if p_voucher_id is null or p_user_id is null then raise exception 'VOUCHER_INVALID'; end if;
 select id,active,starts_at,expires_at,usage_limit,used_count into v_voucher from public.vouchers where id=p_voucher_id for update;
 if not found or not v_voucher.active or v_voucher.starts_at>now()
    or (v_voucher.expires_at is not null and v_voucher.expires_at<=now())
    or (v_voucher.usage_limit is not null and v_voucher.used_count>=v_voucher.usage_limit)
 then raise exception 'VOUCHER_UNAVAILABLE'; end if;
 select id,used_at into v_claim from public.user_vouchers where voucher_id=p_voucher_id and user_id=p_user_id for update;
 if not found or v_claim.used_at is not null then raise exception 'VOUCHER_NOT_CLAIMED_OR_USED'; end if;
 update public.user_vouchers set used_at=now() where id=v_claim.id;
 update public.vouchers set used_count=used_count+1,updated_at=now() where id=p_voucher_id;
end;
$$;
revoke execute on function public.consume_user_voucher(uuid,uuid) from public,anon,authenticated;

create or replace function public.release_user_voucher(p_voucher_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_claim record;
begin
 if p_voucher_id is null or p_user_id is null then return; end if;
 select id,used_at into v_claim from public.user_vouchers where voucher_id=p_voucher_id and user_id=p_user_id for update;
 if not found or v_claim.used_at is null then return; end if;
 update public.user_vouchers set used_at=null where id=v_claim.id;
 update public.vouchers set used_count=greatest(0,used_count-1),updated_at=now() where id=p_voucher_id;
end;
$$;
revoke execute on function public.release_user_voucher(uuid,uuid) from public,anon,authenticated;

alter table public.vouchers add constraint vouchers_used_count_nonnegative check (used_count>=0);
alter table public.vouchers add constraint vouchers_usage_limit_valid check (usage_limit is null or usage_limit>=0);
