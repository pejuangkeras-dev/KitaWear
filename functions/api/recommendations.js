function json(data,status=200,cache="private, no-store"){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":cache}});}
const clean=v=>String(v??"").trim();
async function authUser(ctx){
  const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(ctx.env.SUPABASE_ANON_KEY),h=ctx.request.headers.get("Authorization")||"";
  if(!base||!anon||!/^Bearer\s+/i.test(h))return null;
  const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
  return r.ok?r.json().catch(()=>null):null;
}
async function rpc(ctx,args){
  const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!base||!key)throw Error("Konfigurasi Supabase server belum lengkap.");
  const r=await fetch(base+"/rest/v1/rpc/get_personalized_recommendations",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(args)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
  if(!r.ok)throw Error(data?.message||data?.details||"Gagal memuat rekomendasi.");
  return data;
}
export async function onRequestGet(ctx){
  try{
    const u=await authUser(ctx),url=new URL(ctx.request.url);
    const rawSession=clean(url.searchParams.get("session_id"));
    const sessionId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawSession)?rawSession:null;
    const limit=Math.min(24,Math.max(1,Number.parseInt(url.searchParams.get("limit")||"12",10)||12));
    const data=await rpc(ctx,{p_user_id:u?.id||null,p_session_id:sessionId,p_limit:limit});
    return json(data);
  }catch(e){return json({error:e.message||"Gagal memuat rekomendasi."},500);}
}
