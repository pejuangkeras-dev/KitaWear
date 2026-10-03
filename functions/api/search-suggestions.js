function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=20, stale-while-revalidate=60"}});}
function clean(v,max=120){return String(v??"").trim().slice(0,max);}
export async function onRequestGet({request,env}){
  try{
    const u=new URL(request.url),q=clean(u.searchParams.get("q"));
    if(q.length<2)return json({suggestions:[]});
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
    const r=await fetch(String(env.SUPABASE_URL).replace(/\/+$/,"")+"/rest/v1/rpc/search_public_suggestions_v2",{method:"POST",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_query:q,p_limit:8})});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
    if(!r.ok)return json({error:data?.message||"Gagal memuat saran pencarian."},502);
    return json(data?.suggestions!==undefined?data:{suggestions:[]});
  }catch(e){console.error("MarketKita search suggestions:",e);return json({error:e?.message||"Gagal memuat saran pencarian."},500);}
}
