-- P33 Performance & Scale: optimize auth.uid() evaluation in high-traffic RLS policies.
-- Wrapping auth.uid() in a scalar SELECT lets PostgreSQL initialize the value once per statement
-- instead of re-evaluating it for every candidate row.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

create or replace function public.is_seller_or_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('seller','admin')
  );
$$;

do $$
declare
  p record;
  q text;
  w text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and (
        coalesce(qual,'') like '%auth.uid()%'
        or coalesce(with_check,'') like '%auth.uid()%'
      )
      and (
        coalesce(qual,'') not like '%( SELECT auth.uid()%'
        or coalesce(with_check,'') not like '%( SELECT auth.uid()%'
      )
  loop
    q:=p.qual;
    w:=p.with_check;

    if q is not null and q like '%auth.uid()%' then
      q:=replace(q,'auth.uid()','(select auth.uid())');
    end if;

    if w is not null and w like '%auth.uid()%' then
      w:=replace(w,'auth.uid()','(select auth.uid())');
    end if;

    if q is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        p.policyname,p.schemaname,p.tablename,q
      );
    end if;

    if w is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        p.policyname,p.schemaname,p.tablename,w
      );
    end if;
  end loop;
end
$$;
