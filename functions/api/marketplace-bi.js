function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v??"").trim();
async function service(ctx,path,opt={}){const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);if(!base||!key)throw Error("Supabase server belum dikonfigurasi.");const r=await fetch(base+path,{...opt,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(opt.headers||{})}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw Error(d?.message||d?.details||d?.hint||d?.error||("Supabase HTTP "+r.status));return d;}
async function authUser(ctx){const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(ctx.env.SUPABASE_ANON_KEY),h=ctx.request.headers.get("Authorization")||"";if(!base||!anon||!/^Bearer\s+/i.test(h))return null;const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});return r.ok?r.json().catch(()=>null):null;}
async function profile(ctx,id){const rows=await service(ctx,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(id)+"&limit=1");return rows?.[0]||null;}
async function rpc(ctx,name,args){return service(ctx,"/rest/v1/rpc/"+name,{method:"POST",body:JSON.stringify(args)});}
export async function onRequestGet(ctx){
 try{
  const u=await authUser(ctx);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
  const p=await profile(ctx,u.id);if(String(p?.role||"").toLowerCase()!=="admin")return json({error:"ADMIN_REQUIRED"},403);
  const url=new URL(ctx.request.url);const now=new Date();const fallbackFrom=new Date(now.getTime()-29*86400000);
  const from=url.searchParams.get("from")||fallbackFrom.toISOString().slice(0,10);const to=url.searchParams.get("to")||now.toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return json({error:"INVALID_DATE"},400);
  const data=await rpc(ctx,"marketplace_bi_dashboard",{p_from:from,p_to:to});
  return json({ok:true,from,to,data:data?.[0]??data});
 }catch(e){return json({error:e.message||"Gagal memuat BI."},500);}
}