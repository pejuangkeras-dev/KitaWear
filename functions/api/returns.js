function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function base(v){return String(v||"").trim().replace(/\/+$/,"")}
async function sb(url,key,path,options={}){const r=await fetch(url+path,{...options,headers:{apikey:key,Authorization:`Bearer ${options.token||key}`,"Content-Type":"application/json",...(options.headers||{})}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw new Error(d?.message||d?.details||d?.hint||d?.error||`Supabase HTTP ${r.status}`);return d}
async function user(url,anon,token){const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:`Bearer ${token}`}});return r.ok?r.json():null}
export async function onRequestGet({request,env}){try{const url=base(env.SUPABASE_URL),key=String(env.SUPABASE_SERVICE_ROLE_KEY||""),anon=String(env.SUPABASE_ANON_KEY||"");if(!url||!key||!anon)return json({error:"Konfigurasi server belum lengkap."},500);const token=String(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({error:"Silakan login terlebih dahulu."},401);const u=await user(url,anon,token);if(!u?.id)return json({error:"Sesi login tidak valid."},401);const q=new URL(request.url).searchParams;let path="/rest/v1/return_requests?select=*&order=created_at.desc&limit=100";if(q.get("order_id"))path+="&order_id=eq."+encodeURIComponent(q.get("order_id"));else path+="&buyer_id=eq."+encodeURIComponent(u.id);const rows=await sb(url,key,path);return json({requests:Array.isArray(rows)?rows:[]})}catch(e){return json({error:e.message||"Gagal mengambil pengajuan retur."},500)}}
export async function onRequestPost({request,env}){try{const url=base(env.SUPABASE_URL),anon=String(env.SUPABASE_ANON_KEY||"");const token=String(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({error:"Silakan login terlebih dahulu."},401);const u=await user(url,anon,token);if(!u?.id)return json({error:"Sesi login tidak valid."},401);const body=await request.json();if(!body?.order_item_id||!body?.type||!body?.reason)return json({error:"Data pengajuan belum lengkap."},400);const result=await sb(url,anon,"/rest/v1/rpc/request_return",{method:"POST",token,body:JSON.stringify({p_order_item_id:body.order_item_id,p_type:body.type,p_reason:body.reason,p_description:body.description||null,p_evidence_urls:Array.isArray(body.evidence_urls)?body.evidence_urls:[]})});return json(result)}catch(e){const msg=e.message||"Gagal membuat pengajuan retur.";const status=/login|sesi/i.test(msg)?401:/sudah|tidak ditemukan|hanya tersedia|belum lunas/i.test(msg)?403:400;return json({error:msg},status)}}

export async function onRequestPut({request,env}){try{
  const url=base(env.SUPABASE_URL),anon=String(env.SUPABASE_ANON_KEY||"");
  const token=String(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({error:"Silakan login terlebih dahulu."},401);
  const u=await user(url,anon,token);if(!u?.id)return json({error:"Sesi login tidak valid."},401);
  const body=await request.json().catch(()=>({}));
  if(!body?.return_id||!body?.status)return json({error:"return_id dan status wajib diisi."},400);
  const result=await sb(url,anon,"/rest/v1/rpc/seller_update_return",{method:"POST",token,body:JSON.stringify({
    p_return_id:body.return_id,p_status:body.status,p_tracking_number:body.tracking_number||null,p_note:body.note||null
  })});
  return json({return_request:Array.isArray(result)?result[0]:result});
}catch(e){
  const msg=e.message||"Gagal memperbarui retur.";
  const status=/login|sesi/i.test(msg)?401:/akses ditolak/i.test(msg)?403:400;
  return json({error:msg},status);
}}
