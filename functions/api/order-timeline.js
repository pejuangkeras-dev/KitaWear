function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
async function user(request,u,a){
  const h=request.headers.get("Authorization")||"";
  if(!/^Bearer\s+/i.test(h))return null;
  const r=await fetch(u+"/auth/v1/user",{headers:{apikey:a,Authorization:h}});
  if(!r.ok)return null;
  const d=await r.json().catch(()=>null);
  return d?.id?d:null;
}
async function sb(u,k,path,opts={}){
  const r=await fetch(u+path,{...opts,headers:{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json",...(opts.headers||{})}});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}
  if(!r.ok)throw new Error(d?.message||d?.details||d?.hint||d?.error||("Supabase HTTP "+r.status));
  return d;
}
export async function onRequestGet(context){
  try{
    const u=clean(context.env.SUPABASE_URL).replace(/\/+$/,""),k=clean(context.env.SUPABASE_SERVICE_ROLE_KEY),a=clean(context.env.SUPABASE_ANON_KEY);
    if(!u||!k||!a)return json({error:"Konfigurasi Supabase belum lengkap."},500);
    const me=await user(context.request,u,a);if(!me)return json({error:"LOGIN_REQUIRED"},401);
    const id=clean(new URL(context.request.url).searchParams.get("order_id"));if(!id)return json({error:"order_id wajib."},400);
    const orders=await sb(u,k,"/rest/v1/orders?select=id,order_number,buyer_id&id=eq."+encodeURIComponent(id)+"&limit=1");
    const order=orders?.[0];if(!order)return json({error:"Pesanan tidak ditemukan."},404);
    const profiles=await sb(u,k,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(me.id)+"&limit=1");
    const role=clean(profiles?.[0]?.role).toLowerCase();
    const sellers=await sb(u,k,"/rest/v1/order_sellers?select=id,seller_id&order_id=eq."+encodeURIComponent(id));
    const allowed=String(order.buyer_id)===String(me.id)||role==="admin"||sellers.some(x=>String(x.seller_id)===String(me.id));
    if(!allowed)return json({error:"Akses ditolak."},403);
    const timeline=await sb(u,k,"/rest/v1/rpc/get_order_timeline",{method:"POST",body:JSON.stringify({p_order_id:id})});
    return json({ok:true,order_id:id,order_number:order.order_number,timeline:timeline||{order_status_events:[],shipping_events:[],shipments:[]}});
  }catch(e){console.error("MarketKita order timeline:",e?.message||e);return json({error:e?.message||"Gagal memuat timeline pesanan."},500);}
}
