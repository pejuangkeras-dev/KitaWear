-- P32 Trust & Safety
create table if not exists public.safety_reports (id uuid primary key default gen_random_uuid(),reporter_id uuid not null references auth.users(id) on delete cascade,target_type text not null check(target_type in('user','store','product','order','review','chat')),target_id uuid not null,reason text not null check(reason in('fraud','scam','harassment','counterfeit','abuse','spam','unsafe_content','payment_issue','other')),description text not null check(char_length(trim(description)) between 5 and 4000),status text not null default 'open' check(status in('open','reviewing','resolved','dismissed')),priority text not null default 'normal' check(priority in('low','normal','high','critical')),resolution_note text,resolved_by uuid references auth.users(id),resolved_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.user_blocks (id uuid primary key default gen_random_uuid(),blocker_id uuid not null references auth.users(id) on delete cascade,blocked_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),constraint user_blocks_not_self check(blocker_id<>blocked_id),constraint user_blocks_unique unique(blocker_id,blocked_id));
create table if not exists public.safety_moderation_actions (id uuid primary key default gen_random_uuid(),report_id uuid not null references public.safety_reports(id) on delete cascade,admin_id uuid not null references auth.users(id),action text not null check(action in('review','resolve','dismiss','restrict_user','unrestrict_user','hide_product','unhide_product','warn')),note text,created_at timestamptz not null default now());
create index if not exists safety_reports_status_priority_idx on public.safety_reports(status,priority,created_at desc);
create index if not exists safety_reports_reporter_idx on public.safety_reports(reporter_id,created_at desc);
create index if not exists safety_reports_target_idx on public.safety_reports(target_type,target_id,created_at desc);
create index if not exists user_blocks_blocker_idx on public.user_blocks(blocker_id,created_at desc);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id,created_at desc);
create index if not exists safety_moderation_report_idx on public.safety_moderation_actions(report_id,created_at desc);
alter table public.safety_reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.safety_moderation_actions enable row level security;
drop policy if exists safety_reports_select_own on public.safety_reports; create policy safety_reports_select_own on public.safety_reports for select to authenticated using((select auth.uid())=reporter_id);
drop policy if exists safety_reports_insert_own on public.safety_reports; create policy safety_reports_insert_own on public.safety_reports for insert to authenticated with check((select auth.uid())=reporter_id);
drop policy if exists user_blocks_own on public.user_blocks; create policy user_blocks_own on public.user_blocks for all to authenticated using((select auth.uid())=blocker_id) with check((select auth.uid())=blocker_id);
drop policy if exists moderation_admin_none on public.safety_moderation_actions; create policy moderation_admin_none on public.safety_moderation_actions for all to authenticated using(false) with check(false);
revoke all on public.safety_reports,public.user_blocks,public.safety_moderation_actions from anon,authenticated;
grant select,insert on public.safety_reports to authenticated;
grant select,insert,update,delete on public.user_blocks to authenticated;
create or replace function public.submit_safety_report(p_target_type text,p_target_id uuid,p_reason text,p_description text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; begin
if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
if p_target_id is null then raise exception 'TARGET_REQUIRED'; end if;
if p_target_type not in('user','store','product','order','review','chat') then raise exception 'TARGET_TYPE_INVALID'; end if;
if p_reason not in('fraud','scam','harassment','counterfeit','abuse','spam','unsafe_content','payment_issue','other') then raise exception 'REASON_INVALID'; end if;
if char_length(trim(coalesce(p_description,''))) not between 5 and 4000 then raise exception 'DESCRIPTION_INVALID'; end if;
if p_target_type='user' and p_target_id=auth.uid() then raise exception 'SELF_REPORT_INVALID'; end if;
if exists(select 1 from public.safety_reports where reporter_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and status in('open','reviewing')) then raise exception 'REPORT_ALREADY_OPEN'; end if;
insert into public.safety_reports(reporter_id,target_type,target_id,reason,description) values(auth.uid(),p_target_type,p_target_id,p_reason,trim(p_description)) returning id into v_id; return v_id; end $$;
revoke all on function public.submit_safety_report(text,uuid,text,text) from public,anon,authenticated; grant execute on function public.submit_safety_report(text,uuid,text,text) to authenticated;
create or replace function public.toggle_user_block(p_blocked_id uuid,p_block boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if; if p_blocked_id is null or p_blocked_id=auth.uid() then raise exception 'BLOCK_TARGET_INVALID'; end if; if p_block then insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),p_blocked_id) on conflict(blocker_id,blocked_id) do nothing; else delete from public.user_blocks where blocker_id=auth.uid() and blocked_id=p_blocked_id; end if; return jsonb_build_object('blocked',p_block,'blocked_id',p_blocked_id); end $$;
revoke all on function public.toggle_user_block(uuid,boolean) from public,anon,authenticated; grant execute on function public.toggle_user_block(uuid,boolean) to authenticated;
create or replace function public.admin_moderate_safety_report(p_report_id uuid,p_status text,p_action text,p_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_admin uuid:=auth.uid(); v_role text; v_report public.safety_reports%rowtype; begin
if v_admin is null then raise exception 'LOGIN_REQUIRED'; end if; select role::text into v_role from public.profiles where id=v_admin; if v_role<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
if p_status not in('reviewing','resolved','dismissed') then raise exception 'STATUS_INVALID'; end if; if p_action not in('review','resolve','dismiss','restrict_user','unrestrict_user','hide_product','unhide_product','warn') then raise exception 'ACTION_INVALID'; end if;
select * into v_report from public.safety_reports where id=p_report_id for update; if not found then raise exception 'REPORT_NOT_FOUND'; end if;
update public.safety_reports set status=p_status,resolution_note=nullif(trim(coalesce(p_note,'')),''),resolved_by=case when p_status in('resolved','dismissed') then v_admin else null end,resolved_at=case when p_status in('resolved','dismissed') then now() else null end,updated_at=now() where id=p_report_id;
insert into public.safety_moderation_actions(report_id,admin_id,action,note) values(p_report_id,v_admin,p_action,nullif(trim(coalesce(p_note,'')),''));
insert into public.admin_audit_logs(actor_id,action,entity_type,entity_id,metadata) values(v_admin,'safety_'||p_action,'safety_report',p_report_id,jsonb_build_object('status',p_status,'target_type',v_report.target_type,'target_id',v_report.target_id));
return jsonb_build_object('ok',true,'report_id',p_report_id,'status',p_status,'action',p_action); end $$;
revoke all on function public.admin_moderate_safety_report(uuid,text,text,text) from public,anon,authenticated; grant execute on function public.admin_moderate_safety_report(uuid,text,text,text) to authenticated;