-- P30 Search & Discovery
-- Server-side public product search with relevance, filters, facets, sorting and pagination.

create index if not exists products_search_name_idx
  on public.products using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(category,'') || ' ' || coalesce(description,'')));

create index if not exists products_search_store_status_idx
  on public.products (store_id,status,price);

create index if not exists product_reviews_product_rating_idx
  on public.product_reviews (product_id,rating);

create index if not exists seller_reviews_store_rating_idx
  on public.seller_reviews (store_id,rating);

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
    lower(trim(coalesce(p_query,''))) q,
    lower(trim(coalesce(p_category,''))) category,
    lower(trim(coalesce(p_store_slug,''))) store_slug,
    greatest(coalesce(p_min_price,0),0) min_price,
    greatest(coalesce(p_max_price,0),0) max_price,
    case when p_sort in ('relevance','price_asc','price_desc','name_asc','rating_desc','newest') then p_sort else 'relevance' end sort_mode,
    greatest(coalesce(p_page,1),1) page_no,
    least(greatest(coalesce(p_page_size,24),1),48) page_size
),
base as (
  select
    p.id,p.store_id,p.name,p.slug,p.price,p.description,p.category,p.image_url,p.gallery,p.colors,p.created_at,
    jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'status',s.status) store,
    coalesce(pr.review_count,0)::integer review_count,
    coalesce(pr.product_rating,0)::numeric product_rating,
    coalesce(sr.seller_review_count,0)::integer seller_review_count,
    coalesce(sr.seller_rating,0)::numeric seller_rating,
    case
      when params.q='' then 0::numeric
      when lower(p.name)=params.q then 100
      when lower(p.name) like params.q||'%' then 80
      when lower(coalesce(p.category,''))=params.q then 70
      when lower(coalesce(s.name,''))=params.q then 65
      when lower(p.name) like '%'||params.q||'%' then 50
      when lower(coalesce(p.category,'')) like '%'||params.q||'%' then 40
      when lower(coalesce(s.name,'')) like '%'||params.q||'%' then 35
      when lower(coalesce(p.description,'')) like '%'||params.q||'%' then 20
      else 0
    end relevance
  from public.products p
  join public.stores s on s.id=p.store_id and s.status='active'
  cross join params
  left join (
    select product_id,
      count(*) filter(where rating between 1 and 5)::integer review_count,
      round(avg(rating) filter(where rating between 1 and 5),2)::numeric product_rating
    from public.product_reviews group by product_id
  ) pr on pr.product_id=p.id
  left join (
    select store_id,
      count(*) filter(where rating between 1 and 5)::integer seller_review_count,
      round(avg(rating) filter(where rating between 1 and 5),2)::numeric seller_rating
    from public.seller_reviews group by store_id
  ) sr on sr.store_id=p.store_id
  where p.status='active' and p.price>0
    and (params.q='' or lower(p.name) like '%'||params.q||'%' or lower(coalesce(p.category,'')) like '%'||params.q||'%' or lower(coalesce(p.description,'')) like '%'||params.q||'%' or lower(s.name) like '%'||params.q||'%')
    and (params.category='' or lower(coalesce(p.category,''))=params.category)
    and (params.store_slug='' or lower(s.slug)=params.store_slug)
    and (params.min_price=0 or p.price>=params.min_price)
    and (params.max_price=0 or p.price<=params.max_price)
),
counted as (
  select base.*,count(*) over()::integer total_count from base
),
paged as (
  select c.* from counted c
  order by
    case when (select sort_mode from params)='relevance' then c.relevance end desc,
    case when (select sort_mode from params)='rating_desc' then c.product_rating end desc,
    case when (select sort_mode from params)='price_asc' then c.price end asc,
    case when (select sort_mode from params)='price_desc' then c.price end desc,
    case when (select sort_mode from params)='name_asc' then lower(c.name) end asc,
    case when (select sort_mode from params)='newest' then c.created_at end desc,
    c.created_at desc
  offset (select (page_no-1)*page_size from params)
  limit (select page_size from params)
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
    ) order by p.relevance desc,p.created_at desc)
    from paged p
  ),'[]'::jsonb),
  'total_count',coalesce((select max(total_count) from paged),0),
  'page',(select page_no from params),
  'page_size',(select page_size from params),
  'has_more',coalesce((select max(total_count) from paged),0)>((select page_no from params)*(select page_size from params)),
  'query',(select q from params),
  'categories',coalesce((
    select jsonb_agg(x.category order by x.category)
    from (select distinct nullif(trim(category),'') category from base where nullif(trim(category),'') is not null) x
  ),'[]'::jsonb),
  'stores',coalesce((
    select jsonb_agg(jsonb_build_object('name',x.store->>'name','slug',x.store->>'slug') order by x.store->>'name')
    from (select distinct store from base) x
  ),'[]'::jsonb)
);
$$;

revoke execute on function public.search_public_products(text,text,text,integer,integer,text,integer,integer) from public,anon,authenticated;
grant execute on function public.search_public_products(text,text,text,integer,integer,text,integer,integer) to service_role;
