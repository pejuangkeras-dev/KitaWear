-- G1 Search 2.0
-- Server-side search v2 with stable sorting and public suggestions.
create or replace function public.search_public_products_v2(
  p_query text default '', p_category text default '', p_store_slug text default '',
  p_min_price integer default 0, p_max_price integer default 0, p_sort text default 'relevance',
  p_page integer default 1, p_page_size integer default 24
) returns jsonb
language sql security definer set search_path=''
as $$
with p as (
 select lower(trim(coalesce(p_query,''))) q,
 lower(trim(coalesce(p_category,''))) cat,
 lower(trim(coalesce(p_store_slug,''))) store,
 greatest(coalesce(p_min_price,0),0) minp,
 greatest(coalesce(p_max_price,0),0) maxp,
 case when p_sort in ('relevance','price_asc','price_desc','name_asc','rating_desc','newest') then p_sort else 'relevance' end sortmode,
 greatest(coalesce(p_page,1),1) pg,
 least(greatest(coalesce(p_page_size,24),1),48) ps
), b as (
 select pr.*,s.name store_name,s.slug store_slug,
 coalesce(rv.rating,0)::numeric rating,coalesce(rv.cnt,0)::integer review_count,
 case
  when p.q='' then 0
  when lower(pr.name)=p.q then 100
  when lower(pr.name) like p.q||'%' then 80
  when lower(pr.name) like '%'||p.q||'%' then 50
  when lower(coalesce(pr.category,'')) like '%'||p.q||'%' then 35
  when lower(coalesce(pr.description,'')) like '%'||p.q||'%' then 15
  when lower(s.name) like '%'||p.q||'%' then 30
  else 0
 end relevance
 from public.products pr
 join public.stores s on s.id=pr.store_id and s.status='active'
 cross join p
 left join (
   select product_id,
   round(avg(rating) filter(where rating between 1 and 5),2) rating,
   count(*) filter(where rating between 1 and 5) cnt
   from public.product_reviews group by product_id
 ) rv on rv.product_id=pr.id
 where pr.status='active' and pr.price>0
 and (p.q='' or lower(pr.name) like '%'||p.q||'%' or lower(coalesce(pr.category,'')) like '%'||p.q||'%' or lower(coalesce(pr.description,'')) like '%'||p.q||'%' or lower(s.name) like '%'||p.q||'%')
 and (p.cat='' or lower(coalesce(pr.category,''))=p.cat)
 and (p.store='' or lower(s.slug)=p.store)
 and (p.minp=0 or pr.price>=p.minp)
 and (p.maxp=0 or pr.price<=p.maxp)
), c as (
 select b.*,count(*) over() total from b
), page as (
 select c.* from c,p where true
 order by
 case when p.sortmode='relevance' then c.relevance end desc nulls last,
 case when p.sortmode='price_asc' then c.price end asc nulls last,
 case when p.sortmode='price_desc' then c.price end desc nulls last,
 case when p.sortmode='name_asc' then lower(c.name) end asc nulls last,
 case when p.sortmode='rating_desc' then c.rating end desc nulls last,
 case when p.sortmode='newest' then c.created_at end desc nulls last,
 c.created_at desc,c.id
 offset (((select pg from p)-1)*(select ps from p))
 limit (select ps from p)
)
select jsonb_build_object(
 'products',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',x.id,'store_id',x.store_id,
    'store',jsonb_build_object('id',x.store_id,'name',x.store_name,'slug',x.store_slug),
    'name',x.name,'slug',x.slug,'price',x.price,
    'description',coalesce(x.description,''),'category',coalesce(x.category,''),
    'image_url',coalesce(x.image_url,''),'gallery',coalesce(x.gallery,'[]'::jsonb),
    'colors',coalesce(x.colors,'[]'::jsonb),'created_at',x.created_at,
    'product_rating',x.rating,'review_count',x.review_count,
    'seller_rating',0,'seller_review_count',0,
    'product_sizes',coalesce((
      select jsonb_agg(jsonb_build_object('size',ps.size,'stock',ps.stock))
      from public.product_sizes ps where ps.product_id=x.id and ps.stock>0
    ),'[]'::jsonb)
   )) from page x
 ),'[]'::jsonb),
 'total_count',coalesce((select max(total) from page),0),
 'page',(select pg from p),'page_size',(select ps from p),
 'has_more',coalesce((select max(total) from page),0)>(select pg*ps from p),
 'query',(select q from p)
)
$$;

create or replace function public.search_public_suggestions_v2(p_query text default '',p_limit integer default 8)
returns jsonb language sql security definer set search_path=''
as $$
with q as (
 select lower(trim(coalesce(p_query,''))) v,
 least(greatest(coalesce(p_limit,8),1),12) lim
), s as (
 select p.name label,'product' type from public.products p cross join q
 where p.status='active' and q.v<>'' and lower(p.name) like '%'||q.v||'%'
 union
 select distinct p.category,'category' from public.products p cross join q
 where p.status='active' and q.v<>'' and nullif(trim(p.category),'') is not null and lower(p.category) like '%'||q.v||'%'
 union
 select st.name,'store' from public.stores st cross join q
 where st.status='active' and q.v<>'' and lower(st.name) like '%'||q.v||'%'
)
select jsonb_build_object(
 'suggestions',coalesce((
   select jsonb_agg(jsonb_build_object('label',x.label,'type',x.type))
   from (select distinct label,type from s limit (select lim from q)) x
 ),'[]'::jsonb)
)
$$;

revoke execute on function public.search_public_products_v2(text,text,text,integer,integer,text,integer,integer) from public,anon,authenticated;
revoke execute on function public.search_public_suggestions_v2(text,integer) from public,anon,authenticated;
grant execute on function public.search_public_products_v2(text,text,text,integer,integer,text,integer,integer) to service_role;
grant execute on function public.search_public_suggestions_v2(text,integer) to service_role;
