-- G2 Personalized Recommendations
create or replace function public.get_personalized_recommendations(
  p_user_id uuid default null,
  p_session_id uuid default null,
  p_limit integer default 12
) returns jsonb
language sql
security definer
set search_path=''
as $$
with cfg as (
  select p_user_id uid,p_session_id sid,least(greatest(coalesce(p_limit,12),1),24) lim
),
signals as (
  select ae.product_id,
    count(*) filter (where ae.event_name='product_view')::numeric +
    count(*) filter (where ae.event_name='add_to_cart')::numeric * 4 as signal_score
  from public.analytics_events ae cross join cfg
  where ae.product_id is not null and ae.created_at >= now()-interval '30 days'
    and ((cfg.uid is not null and ae.user_id=cfg.uid) or (cfg.sid is not null and ae.session_id=cfg.sid))
  group by ae.product_id
),
interest_categories as (
  select p.category,sum(s.signal_score) score from signals s join public.products p on p.id=s.product_id
  where nullif(trim(p.category),'') is not null group by p.category
),
interest_stores as (
  select p.store_id,sum(s.signal_score) score from signals s join public.products p on p.id=s.product_id group by p.store_id
),
seen as (
  select distinct ae.product_id from public.analytics_events ae cross join cfg
  where ae.product_id is not null and ae.created_at >= now()-interval '30 days'
    and ((cfg.uid is not null and ae.user_id=cfg.uid) or (cfg.sid is not null and ae.session_id=cfg.sid))
),
popularity as (
  select ae.product_id,
    count(*) filter(where ae.event_name='product_view')::numeric +
    count(*) filter(where ae.event_name='add_to_cart')::numeric*3 as popularity_score
  from public.analytics_events ae where ae.product_id is not null and ae.created_at>=now()-interval '14 days'
  group by ae.product_id
),
reviews as (
  select product_id,round(avg(rating) filter(where rating between 1 and 5),2) rating,
    count(*) filter(where rating between 1 and 5) cnt
  from public.product_reviews group by product_id
),
candidates as (
  select p.id,p.store_id,p.name,p.slug,p.price,p.description,p.category,p.image_url,p.gallery,p.colors,p.created_at,
    s.name store_name,s.slug store_slug,coalesce(rv.rating,0)::numeric rating,coalesce(rv.cnt,0)::integer review_count,
    coalesce(ic.score,0)::numeric category_score,coalesce(isx.score,0)::numeric store_score,
    coalesce(pop.popularity_score,0)::numeric popularity_score,
    coalesce(ic.score,0)*7+coalesce(isx.score,0)*3+coalesce(pop.popularity_score,0)*0.35+
    coalesce(rv.rating,0)*2+case when p.created_at>=now()-interval '14 days' then 1.5 else 0 end recommendation_score
  from public.products p join public.stores s on s.id=p.store_id and s.status='active'
  left join interest_categories ic on lower(ic.category)=lower(p.category)
  left join interest_stores isx on isx.store_id=p.store_id
  left join popularity pop on pop.product_id=p.id
  left join reviews rv on rv.product_id=p.id
  where p.status='active' and p.price>0 and not exists(select 1 from seen x where x.product_id=p.id)
),
ranked as (
  select *,row_number() over(order by recommendation_score desc,rating desc,popularity_score desc,created_at desc,id) rn from candidates
),
fallback as (
  select p.id,p.store_id,p.name,p.slug,p.price,p.description,p.category,p.image_url,p.gallery,p.colors,p.created_at,
    s.name store_name,s.slug store_slug,coalesce(rv.rating,0)::numeric rating,coalesce(rv.cnt,0)::integer review_count,
    coalesce(pop.popularity_score,0)::numeric popularity_score,
    row_number() over(order by coalesce(pop.popularity_score,0) desc,coalesce(rv.rating,0) desc,p.created_at desc,p.id) rn
  from public.products p join public.stores s on s.id=p.store_id and s.status='active'
  left join popularity pop on pop.product_id=p.id left join reviews rv on rv.product_id=p.id
  where p.status='active' and p.price>0
),
payload as (
  select x.id,x.store_id,x.name,x.slug,x.price,x.description,x.category,x.image_url,x.gallery,x.colors,x.created_at,
    x.store_name,x.store_slug,x.rating,x.review_count,x.popularity_score,x.recommendation_score,
    case when x.category_score>0 or x.store_score>0 then 'personalized' else 'trending' end recommendation_source
  from ranked x where x.rn <= (select lim from cfg)
  union all
  select x.id,x.store_id,x.name,x.slug,x.price,x.description,x.category,x.image_url,x.gallery,x.colors,x.created_at,
    x.store_name,x.store_slug,x.rating,x.review_count,x.popularity_score,coalesce(x.popularity_score,0) recommendation_score,'trending'
  from fallback x
  where x.rn <= (select lim from cfg)
    and not exists(select 1 from ranked r where r.rn <= (select lim from cfg))
)
select jsonb_build_object(
  'products',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',x.id,'store_id',x.store_id,'store',jsonb_build_object('id',x.store_id,'name',x.store_name,'slug',x.store_slug),
      'name',x.name,'slug',x.slug,'price',x.price,'description',coalesce(x.description,''),'category',coalesce(x.category,''),
      'image_url',coalesce(x.image_url,''),'gallery',coalesce(x.gallery,'[]'::jsonb),'colors',coalesce(x.colors,'[]'::jsonb),
      'created_at',x.created_at,'product_rating',x.rating,'review_count',x.review_count,'seller_rating',0,'seller_review_count',0,
      'product_sizes',coalesce((select jsonb_agg(jsonb_build_object('size',ps.size,'stock',ps.stock))
        from public.product_sizes ps where ps.product_id=x.id and ps.stock>0),'[]'::jsonb),
      'recommendation_score',x.recommendation_score,'recommendation_source',x.recommendation_source
    ) order by x.recommendation_score desc,x.rating desc,x.popularity_score desc,x.created_at desc,x.id)
    from payload x),'[]'::jsonb),
  'mode',case when exists(select 1 from signals) then 'personalized' else 'trending' end,
  'limit',(select lim from cfg)
)
$$;

revoke execute on function public.get_personalized_recommendations(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_personalized_recommendations(uuid,uuid,integer) to service_role;
