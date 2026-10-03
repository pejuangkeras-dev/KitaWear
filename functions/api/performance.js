function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v??"").trim();
async function getUser(env,h){const base=clean(env.SUPABASE_URL).replace(/\/+$/,""),key=clean(env.SUPABASE_ANON_KEY);if(!base||!key||!/^Bearer\s+/i.test(h))return null;const r=await fetch(base+"/auth/v1/user",{headers:{apikey:key,Authorization:h}});return r.ok?r.json().catch(()=>null):null}
async function service(env,path){const base=clean(env.SUPABASE_URL).replace(/\/+$/,""),key=clean(env.SUPABASE_SERVICE_ROLE_KEY);if(!base||!key)throw Error("SUPABASE_SERVER_CONFIG_MISSING");const r=await fetch(base+path,{headers:{apikey:key,Authorization:"Bearer "+key}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=null}if(!r.ok)throw Error(d?.message||d?.details||"Supabase probe failed");return d}
async function timed(fn){const start=performance.now();try{await fn();return {ok:true,ms:Math.round(performance.now()-start)}}catch(e){return {ok:false,ms:Math.round(performance.now()-start),error:e.message||"probe_failed"}}}
export async function onRequestGet(ctx){
 const h=ctx.request.headers.get("Authorization")||"",u=await getUser(ctx.env,h);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
 try{
  const profile=await service(ctx.env,"/rest/v1/profiles?select=role&id=eq."+encodeURIComponent(u.id)+"&limit=1");if(String(profile?.[0]?.role||"").toLowerCase()!=="admin")return json({error:"ADMIN_REQUIRED"},403);
  const db=await timed(()=>service(ctx.env,"/rest/v1/orders?select=id&limit=1"));
  const catalog=await timed(()=>service(ctx.env,"/rest/v1/products?select=id&status=eq.active&limit=24"));
  const search=await timed(async()=>{const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,"");const key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);const r=await fetch(base+"/rest/v1/rpc/search_public_products",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({p_query:"",p_category:"",p_store_slug:"",p_min_price:0,p_max_price:0,p_sort:"newest",p_page:1,p_page_size:24})});if(!r.ok)throw Error("search_probe_http_"+r.status);});
  const healthy=db.ok&&catalog.ok&&search.ok&&db.ms<=500&&catalog.ms<=700&&search.ms<=1000;
  return json({ok:healthy,service:"MarketKita performance",timestamp:new Date().toISOString(),probes:{database:db,catalog:catalog,search:search},cache:{search:"edge cache 15s + stale-while-revalidate 60s",catalog:"edge cache 30s + stale-while-revalidate 120s"},thresholds:{database_ms:500,catalog_ms:700,search_ms:1000},within_thresholds:{database:db.ok&&db.ms<=500,catalog:catalog.ok&&catalog.ms<=700,search:search.ok&&search.ms<=1000}});
 }catch(e){return json({ok:false,error:e.message||"PERFORMANCE_PROBE_FAILED"},500)}
}