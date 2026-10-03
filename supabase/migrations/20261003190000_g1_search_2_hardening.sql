-- G1 Search 2.0 hardening
-- Improves token-aware relevance, Indonesian query normalization, stable sorting,
-- and adds a lightweight public suggestion RPC used only by the server API.

create or replace function public.search_public_products(
  p_query text default '',
  p_category text default '',
  p_store_slug text default '',
  p_min_price integer default 0,
  p_max_price integer default 0,
  p_sort text default 'relevance',
  p_page integer default 1,
  p_page_size integer default 24
) returns jsonb
language sql
security definer
set search_path=''
as $$
with params as (
  select
    lower(trim(regexp_replace(coalesce(p_query,''),'\\s+',' ','g'))) q,
    lower(trim(coalesce(p_category,''))) category,
    lower(trim(coalesce(p_store_slug,''))) store_slug,
    greatest(coalesce(p_min_price,0),0) min_price,
    greatest(coalesce(p_max_price,0),0) max_price,
    case when p_sort in ('relevance','price_asc','price_desc','name_asc','rating_desc','newest') then p_sort else 'relevance' end sort_mode,
    greatest(coalesce(p_page,1),1) page_no,
    least(greatest(coalesce(p_page_size,24),1),48) page_size
),
normalized as (
  select params.*,
    trim(regexp_replace(
      replace(replace(replace(replace(q,'kaos','t-shirt'),'kemeja','shirt'),'jaket','jacket'),'wanita','perempuan'),
      '\\s+',' ','g'
    )) normalized_q
  from params
),
tokens as (
  select distinct trim(x) token
  from normalized, unnest(regexp_split_to_array(normalized_q,'\\s+')) x
  where length(trim(x)) >= 2
),
base as (
  select
    p.id,p.store_id,p.name,p.slug,p.price,p.description,p.category,p.image_url,p.gallery,p.colors,p.created_at,
    jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'status',s.status) store,
    coalesce(pr.review_count,0)::integer review_count,
    coalesce(pr.product_rating,0)::numeric product_rating,
    coalesce(sr.seller_review_count,0)::integer seller_review_count,
    coalesce(sr.seller_rating,0)::numeric seller_rating,
    (
      case
        when n.normalized_q='' then 0::numeric
        else
          (case when lower(p.name)=n.normalized_q then 120 else 0 end) +
          (case when lower(p.name) like n.normalized_q||'%' then 60 else 0 end) +
          (case when lower(coalesce(p.category,''))=n.normalized_q then 50 else 0 end) +
          (select coalesce(sum(
            case
              when lower(p.name) like '%'||t.token||'%' then 20
              when lower(coalesce(p.category,'')) like '%'||t.token||'%' then 14
              when lower(coalesce(s.name,'')) like '%'||t.token||'%' then 10
              when lower(coalesce(p.description,'')) like '%'||t.token||'%' then 4
              else 0
            end
          ),0)::numeric from tokens t)
      end
    ) as relevance
  from public.products p
  join public.stores s on s.id=p.store_id and s.status='active'
  cross join normalized n
  left join (
    select product_id,count(*) filter(where rating between 1 and 5)::integer review_count,
      round(avg(rating) filter(where rating between 1 and 5),2)::numeric product_rating
    from public.product_reviews group by product_id
  ) pr on pr.product_id=p.id
  left join (
    select store_id,count(*) filter(where rating between 1 and 5)::integer seller_review_count,
      round(avg(rating) filter(where rating between 1 and 5),2)::numeric seller_rating
    from public.seller_reviews group by store_id
  ) sr on sr.store_id=p.store_id
  where p.status='active' and p.price>0
    and (
      n.normalized_q='' or
      lower(p.name) like '%'||n.normalized_q||'%' or
      lower(coalesce(p.category,'')) like '%'||n.normalized_q||'%' or
      lower(coalesce(p.description,'')) like '%'||n.normalized_q||'%' or
      lower(s.name) like '%'||n.normalized_q||'%' or
      exists (
        select 1 from tokens t
        where lower(p.name) like '%'||t.token||'%'
           or lower(coalesce(p.category,'')) like '%'||t.token||'%'
           or lower(coalesce(p.description,'')) like '%'||t.token||'%'
           or lower(s.name) like '%'||t.token||'%'
      )
    )
    and (n.category='' or lower(coalesce(p.category,''))=n.category)
    and (n.store_slug='' or lower(s.slug)=n.store_slug)
    and (n.min_price=0 or p.price>=n.min_price)
    and (n.max_price=0 or p.price<=n.max_price)
),
counted as (
  select base.*,count(*) over()::integer total_count from base
),
paged as (
  select c.* from counted c
  order by
    case when (select sort_mode from normalized)='relevance' then c.relevance end desc nulls last,
    case when (select sort_mode from normalized)='rating_desc' then c.product_rating end desc nulls last,
    case when (select sort_mode from normalized)='price_asc' then c.price end asc nulls last,
    case when (select sort_mode from normalized)='price_desc' then c.price end desc nulls last,
    case when (select sort_mode from normalized)='name_asc' then lower(c.name) end asc nulls last,
    case when (select sort_mode from normalized)='newest' then c.created_at end desc nulls last,
    c.created_at desc,
    c.id
  offset (select (page_no-1)*page_size from normalized)
  limit (select page_size from normalized)
)
select jsonb_build_object(
  'products',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,'store_id',p.store_id,'store',p.store,'name',p.name,'slug',p.slug,'price',p.price,
      'description',coalesce(p.description,''),'category',coalesce(p.category,''),'image_url',coalesce(p.image_url,''),
      'gallery',coalesce(p.gallery,'[]'::jsonb),'colors',coalesce(p.colors,'[]'::jsonb),'created_at',p.created_at,
      'product_rating',p.product_rating,'review_count',p.review_count,'seller_rating',p.seller_rating,
      'seller_review_count',p.seller_review_count,
      'product_sizes',coalesce((
        select jsonb_agg(jsonb_build_object('size',ps.size,'stock',ps.stock) order by ps.size)
        from public.product_sizes ps where ps.product_id=p.id and ps.stock>0
      ),'[]'::jsonb)
    ) order by
      case when (select sort_mode from normalized)='relevance' then p.relevance end desc nulls last,
      case when (select sort_mode from normalized)='rating_desc' then p.product_rating end desc nulls last,
      case when (select sort_mode from normalized)='price_asc' then p.price end asc nulls last,
      case when (select sort_mode from normalized)='price_desc' then p.price end desc nulls last,
      case when (select sort_mode from normalized)='name_asc' then lower(p.name) end asc nulls last,
      case when (select sort_mode from normalized)='newest' then p.created_at end desc nulls last,
      p.created_at desc,p.id
    ),'[]'::jsonb)
  ),'[]'::jsonb),
  'total_count',coalesce((select max(total_count) from paged),0),
  'page',(select page_no from normalized),
  'page_size',(select page_size from normalized),
  'has_more',coalesce((select max(total_count) from paged),0)>((select page_no from normalized)*(select page_size from normalized)),
  'query',(select q from normalized),
  'categories',coalesce((select jsonb_agg(x.category order by x.category) from (select distinct nullif(trim(category),'') category from base where nullif(trim(category),'') is not null) x),'[]'::jsonb),
  'stores',coalesce((select jsonb_agg(jsonb_build_object('name',x.store->>'name','slug',x.store->>'slug') order by x.store->>'name') from (select distinct store from base) x),'[]'::jsonb)
);
$$;

create or replace function public.search_public_suggestions(p_query text default '', p_limit integer default 8)
returns jsonb
language sql
security definer
set search_path=''
as $$
with q as (
  select lower(trim(regexp_replace(coalesce(p_query,''),'\\s+',' ','g'))) value,
         least(greatest(coalesce(p_limit,8),1),12) lim
),
items as (
  select p.name label,'product' type,1 priority
  from public.products p cross join q
  where p.status='active' and q.value<>'' and lower(p.name) like '%'||q.value||'%'
  union
  select distinct p.category,'category',2
  from public.products p cross join q
  where p.status='active' and q.value<>'' and nullif(trim(p.category),'') is not null and lower(p.category) like '%'||q.value||'%'
  union
  select s.name,'store',3
  from public.stores s cross join q
  where s.status='active' and q.value<>'' and lower(s.name) like '%'||q.value||'%'
)
select jsonb_build_object('suggestions',coalesce((
  select jsonb_agg(jsonb_build_object('label',x.label,'type',x.type) order by x.priority,x.label)
  from (select distinct on (label,type) label,type,priority from items order by label,type,priority limit (select lim from q)) x
),'[]'::jsonb));
$$;

revoke execute on function public.search_public_products(text,text,text,integer,integer,text,integer,integer) from public,anon,authenticated;
revoke execute on function public.search_public_suggestions(text,integer) from public,anon,authenticated;
grant execute on function public.search_public_products(text,text,text,integer,integer,text,integer,integer) to service_role;
grant execute on function public.search_public_suggestions(text,integer) to service_role;
