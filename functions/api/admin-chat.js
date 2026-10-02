const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const base=v=>String(v||"").trim().replace(/\/+$/,"");
async function user(request,url,anon){const h=request.headers.get("Authorization")||"";if(!/^Bearer\s+/i.test(h))return null;const t=h.replace(/^Bearer\s+/i,"").trim();const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:"Bearer "+t}});return r.ok?r.json():null}
async function get(url,key,path){const r=await fetch(url+path,{headers:{apikey:key,Authorization:"Bearer "+key}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(!r.ok)throw Error(d.message||d.details||`Supabase HTTP ${r.status}`);return d}
export async function onRequestGet({request,env}){
 try{
  const url=base(env.SUPABASE_URL),service=String(env.SUPABASE_SERVICE_ROLE_KEY||""),anon=String(env.SUPABASE_ANON_KEY||"");
  const u=await user(request,url,anon);if(!u?.id)return json({error:"Login admin diperlukan."},401);
  const profiles=await get(url,service,`/rest/v1/profiles?select=id,role,full_name&id=eq.${encodeURIComponent(u.id)}&limit=1`);
  if(profiles?.[0]?.role!=="admin")return json({error:"Akses ditolak."},403);
  const threads=await get(url,service,"/rest/v1/chat_threads?select=id,buyer_id,seller_id,store_id,updated_at&order=updated_at.desc&limit=100");
  const ids=(threads||[]).map(x=>x.id).filter(Boolean);
  const messages=ids.length?await get(url,service,"/rest/v1/chat_messages?select=id,thread_id,sender_id,body,created_at,read_at&thread_id=in.("+ids.join(",")+")&order=created_at.desc&limit=300"):[];
  return json({threads:Array.isArray(threads)?threads:[],messages:Array.isArray(messages)?messages:[]});
 }catch(e){return json({error:e.message||"Gagal memuat komunikasi."},500)}
}