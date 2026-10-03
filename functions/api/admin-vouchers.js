function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
const clean=v=>String(v==null?"":v).trim();

async function sb(ctx,path,opt={}){
  const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""), key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!base||!key) throw new Error("Supabase server belum dikonfigurasi.");
  const r=await fetch(base+path,{...opt,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(opt.headers||{})}});
  const t=await r.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d={raw:t}}
  if(!r.ok) throw new Error(d?.message||d?.details||d?.hint||d?.error||("Supabase HTTP "+r.status));
  return d;
}
async function user(ctx){
  const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""), anon=clean(ctx.env.SUPABASE_ANON_KEY), h=ctx.request.headers.get("Authorization")||"";
  if(!base||!anon||!/^Bearer\s+/i.test(h)) return null;
  const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
  return r.ok?r.json().catch(()=>null):null;
}
async function admin(ctx){
  const u=await user(ctx); if(!u?.id) return null;
  const rows=await sb(ctx,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(u.id)+"&limit=1");
  return rows?.[0]?.role==="admin"?u:null;
}
function validateBody(b,partial=false){
  if(!b||typeof b!=="object"||Array.isArray(b)) throw new Error("Payload voucher tidak valid.");
  const out={};
  if(!partial||b.code!==undefined){const code=clean(b.code).toUpperCase();if(!/^[A-Z0-9_-]{3,64}$/.test(code))throw new Error("Kode voucher harus 3-64 karakter: A-Z, 0-9, _ atau -.");out.code=code}
  if(!partial||b.title!==undefined){const title=clean(b.title);if(!title||title.length>120)throw new Error("Judul voucher wajib diisi dan maksimal 120 karakter.");out.title=title}
  if(!partial||b.discount_type!==undefined){const t=clean(b.discount_type).toLowerCase();if(!["percent","fixed"].includes(t))throw new Error("discount_type harus percent atau fixed.");out.discount_type=t}
  if(!partial||b.discount_value!==undefined){const n=Number(b.discount_value);if(!Number.isInteger(n)||n<=0)throw new Error("Nilai diskon harus bilangan bulat positif.");out.discount_value=n}
  for(const k of ["description"]){if(b[k]!==undefined)out[k]=clean(b[k])||null}
  for(const k of ["min_order_amount","max_discount","usage_limit"]){if(!partial||b[k]!==undefined){const v=b[k];if(v===null||v===""){out[k]=null;continue}const n=Number(v);if(!Number.isInteger(n)||n<0)throw new Error(k+" harus bilangan bulat >= 0.");out[k]=n}}
  if(!partial||b.starts_at!==undefined)out.starts_at=b.starts_at||new Date().toISOString();
  if(b.expires_at!==undefined)out.expires_at=b.expires_at||null;
  if(b.active!==undefined)out.active=Boolean(b.active);
  return out;
}
export async function onRequestGet(ctx){
  try{
    if(!await admin(ctx))return json({error:"ADMIN_REQUIRED"},403);
    const url=new URL(ctx.request.url), includeInactive=url.searchParams.get("all")==="1";
    const filter=includeInactive?"":"&active=eq.true";
    const rows=await sb(ctx,"/rest/v1/vouchers?select=*&order=created_at.desc&limit=200"+filter);
    return json({ok:true,vouchers:rows||[]});
  }catch(e){return json({error:e.message||"Gagal mengambil voucher."},500)}
}
export async function onRequestPost(ctx){
  try{
    if(!await admin(ctx))return json({error:"ADMIN_REQUIRED"},403);
    if(Number(ctx.request.headers.get("Content-Length")||0)>16384)return json({error:"Payload terlalu besar."},413);
    const b=await ctx.request.json().catch(()=>null), v=validateBody(b);
    if(v.discount_type==="percent"&&v.discount_value>100)throw new Error("Diskon persentase maksimal 100.");
    if(v.expires_at&&new Date(v.expires_at)<=new Date(v.starts_at))throw new Error("Masa berlaku voucher tidak valid.");
    const rows=await sb(ctx,"/rest/v1/vouchers",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(v)});
    return json({ok:true,voucher:rows?.[0]||rows},201);
  }catch(e){return json({error:e.message||"Gagal membuat voucher."},400)}
}
export async function onRequestPatch(ctx){
  try{
    if(!await admin(ctx))return json({error:"ADMIN_REQUIRED"},403);
    const id=clean(new URL(ctx.request.url).searchParams.get("id"));
    if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"ID voucher tidak valid."},400);
    const b=await ctx.request.json().catch(()=>null), v=validateBody(b,true);
    if(v.discount_type==="percent"&&v.discount_value>100)throw new Error("Diskon persentase maksimal 100.");
    if(v.starts_at&&v.expires_at&&new Date(v.expires_at)<=new Date(v.starts_at))throw new Error("Masa berlaku voucher tidak valid.");
    const rows=await sb(ctx,"/rest/v1/vouchers?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(v)});
    if(!rows?.length)return json({error:"Voucher tidak ditemukan."},404);
    return json({ok:true,voucher:rows[0]});
  }catch(e){return json({error:e.message||"Gagal memperbarui voucher."},400)}
}
