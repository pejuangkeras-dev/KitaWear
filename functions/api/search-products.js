function json(data,status=200,cache="public, max-age=15, stale-while-revalidate=60"){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":cache,"X-MarketKita-Cache":"MISS"}});}
function clean(v,max=160){return String(v??"").trim().slice(0,max);}
function intParam(v,fallback=0){const n=Number.parseInt(String(v??""),10);return Number.isFinite(n)&&n>=0?n:fallback;}
function normalizeUrl(v){return String(v||"").trim().replace(/\/+$/,"");}
function cacheKey(request){const u=new URL(request.url);u.searchParams.sort();return new Request(u.toString(),{method:"GET"});}
async function cachedFetch(request,producer){
  const cache=globalThis.caches?.default;
  if(!cache)return producer();
  const key=cacheKey(request);
  const hit=await cache.match(key);
  if(hit){
    const headers=new Headers(hit.headers);headers.set("X-MarketKita-Cache","HIT");
    return new Response(await hit.arrayBuffer(),{status:hit.status,headers});
  }
  const fresh=await producer();
  if(!fresh.ok)return fresh;
  const headers=new Headers(fresh.headers);headers.set("Cache-Control","public, max-age=15, stale-while-revalidate=60");headers.set("CDN-Cache-Control","public, max-age=30, stale-while-revalidate=60");headers.set("X-MarketKita-Cache","MISS");
  const response=new Response(fresh.body,{status:fresh.status,headers});
  try{await cache.put(key,response.clone());}catch{}
  return response;
}
export async function onRequestGet({request,env}){
  try{
    const url=new URL(request.url);
    const query=clean(url.searchParams.get("q")||url.searchParams.get("query"),160);
    const category=clean(url.searchParams.get("category"),120);
    const store=clean(url.searchParams.get("store"),120);
    const min=intParam(url.searchParams.get("min"),0);
    const max=intParam(url.searchParams.get("max"),0);
    const sort=clean(url.searchParams.get("sort")||"relevance",30);
    const page=Math.max(1,intParam(url.searchParams.get("page"),1));
    const pageSize=Math.min(48,Math.max(1,intParam(url.searchParams.get("page_size"),24)));
    if(max>0&&min>max)return json({error:"Harga minimum tidak boleh lebih besar dari harga maksimum."},400,"no-store");
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"Konfigurasi Supabase server belum lengkap."},500,"no-store");
    const endpoint=normalizeUrl(env.SUPABASE_URL)+"/rest/v1/rpc/search_public_products";
    const response=await cachedFetch(request,async()=>{
      const r=await fetch(endpoint,{method:"POST",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_query:query,p_category:category,p_store_slug:store,p_min_price:min,p_max_price:max,p_sort:sort,p_page:page,p_page_size:pageSize})});
      const text=await r.text();let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
      if(!r.ok)return json({error:data?.message||data?.details||"Pencarian produk gagal."},502,"no-store");
      return json(data?.products!==undefined?data:{products:[]});
    });
    return response;
  }catch(error){console.error("MarketKita search-products:",error);return json({error:error?.message||"Pencarian produk gagal."},500,"no-store");}
}
