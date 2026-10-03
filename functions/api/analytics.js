function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v??"").trim();
async function service(ctx,path,opt={}){const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);if(!base||!key)throw Error("Supabase server belum dikonfigurasi.");const r=await fetch(base+path,{...opt,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(opt.headers||{})}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw Error(d?.message||d?.details||d?.hint||d?.error||("Supabase HTTP "+r.status));return d;}
async function authUser(ctx){const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(ctx.env.SUPABASE_ANON_KEY),h=ctx.request.headers.get("Authorization")||"";if(!base||!anon||!/^Bearer\s+/i.test(h))return null;const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});return r.ok?r.json().catch(()=>null):null;}
async function profile(ctx,id){const rows=await service(ctx,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(id)+"&limit=1");return rows?.[0]||null;}
async function rpc(ctx,name,args){return service(ctx,"/rest/v1/rpc/"+name,{method:"POST",body:JSON.stringify(args)});}
export async function onRequestGet(ctx){
 try{
  const u=await authUser(ctx);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
  const p=await profile(ctx,u.id);if(!p)return json({error:"PROFILE_REQUIRED"},403);
  const role=clean(p.role).toLowerCase();let storeId=null;
  const url=new URL(ctx.request.url);const from=url.searchParams.get("from")||new Date(Date.now()-29*86400000).toISOString().slice(0,10);const to=url.searchParams.get("to")||new Date().toISOString().slice(0,10);
  if(role==="seller"){
    const stores=await service(ctx,"/rest/v1/stores?select=id&owner_id=eq."+encodeURIComponent(u.id)+"&limit=1");storeId=stores?.[0]?.id||null;
    if(!storeId)return json({error:"STORE_NOT_FOUND"},404);
  }else if(role!=="admin")return json({error:"ADMIN_OR_SELLER_REQUIRED"},403);
  const data=await rpc(ctx,"analytics_dashboard",{p_from:from,p_to:to,p_store_id:storeId});
  return json({ok:true,role,data:data?.[0]??data});
 }catch(e){return json({error:e.message||"Gagal memuat analytics."},500);}
}
export async function onRequestPost(ctx){
 try{
  if(Number(ctx.request.headers.get("Content-Length")||0)>16384)return json({error:"Payload terlalu besar."},413);
  const b=await ctx.request.json().catch(()=>null);if(!b||typeof b!=="object"||Array.isArray(b))return json({error:"Payload tidak valid."},400);
  const allowed=new Set(["page_view","product_view","search","add_to_cart","checkout_started","purchase_success","login","signup"]);
  const name=clean(b.event_name);if(!allowed.has(name))return json({error:"Event analytics tidak valid."},400);
  const h=ctx.request.headers.get("Authorization")||"";const u=await authUser(ctx);
  const result=await rpc(ctx,"analytics_track_event",{
    p_event_id:clean(b.event_id)||crypto.randomUUID(),p_event_name:name,p_session_id:clean(b.session_id)||null,
    p_user_id:u?.id||null,p_product_id:clean(b.product_id)||null,p_store_id:clean(b.store_id)||null,p_voucher_id:clean(b.voucher_id)||null,
    p_path:clean(b.path)||null,p_referrer:clean(b.referrer)||null,p_metadata:(b.metadata&&typeof b.metadata==="object"&&!Array.isArray(b.metadata))?b.metadata:{}
  });
  return json({ok:true,id:result});
 }catch(e){return json({error:e.message||"Gagal mencatat analytics."},400);}
}
