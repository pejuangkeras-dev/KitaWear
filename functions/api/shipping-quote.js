function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
function supabaseHeaders(key){return {apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"};}
async function sb(url,key,path,options={}){
  const r=await fetch(url+path,{...options,headers:{...supabaseHeaders(key),...(options.headers||{})}});
  const t=await r.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d={raw:t};}
  if(!r.ok) throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);
  return d;
}
async function user(context,url,anon){
  const h=context.request.headers.get("Authorization")||"";
  if(!h.toLowerCase().startsWith("bearer ")||!anon)return null;
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
  if(!r.ok)return null; const d=await r.json().catch(()=>null); return d?.id?d:null;
}
function biteshipKey(env){return String(env.BITESHIP_API_KEY||"").trim();}
async function biteship(env,path,body){
  const key=biteshipKey(env); if(!key) throw new Error("BITESHIP_API_KEY belum dipasang di Cloudflare.");
  const r=await fetch("https://api.biteship.com"+path,{method:"POST",headers:{authorization:key,"content-type":"application/json"},body:JSON.stringify(body)});
  const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{};}catch{d={};}
  if(!r.ok||d?.success===false) throw new Error(d?.message||d?.error||"Biteship gagal menghitung ongkir.");
  return d;
}
export async function onRequestPost(context){
  try{
    const env=context.env, url=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""), key=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim(), anon=String(env.SUPABASE_ANON_KEY||"").trim();
    if(!url||!key)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
    const buyer=await user(context,url,anon); if(!buyer)return json({error:"Silakan login untuk menghitung ongkir."},401);
    const body=await context.request.json().catch(()=>({}));
    const addressId=String(body.address_id||"").trim();
    const rawItems=Array.isArray(body.items)?body.items:[];
    if(!addressId||!rawItems.length)return json({error:"Alamat dan keranjang wajib dipilih."},400);

    const addresses=await sb(url,key,`/rest/v1/buyer_addresses?select=id,recipient_name,phone,address_line,city,province,postal_code&user_id=eq.${encodeURIComponent(buyer.id)}&id=eq.${encodeURIComponent(addressId)}&limit=1`);
    const address=addresses?.[0]; if(!address)return json({error:"Alamat pengiriman tidak ditemukan."},400);
    if(!/^\\d{5}$/.test(String(address.postal_code||"")))return json({error:"Kode pos alamat buyer harus 5 digit."},400);

    const groups=new Map();
    for(const raw of rawItems){
      const pid=String(raw.product_id||"").trim(), size=String(raw.size||"").trim().toUpperCase(), qty=Number(raw.quantity);
      if(!pid||!size||!Number.isInteger(qty)||qty<1||qty>99)throw new Error("Data item checkout tidak valid.");
      const rows=await sb(url,key,`/rest/v1/products?select=id,store_id,name,price,weight_gram,length_cm,width_cm,height_cm&status=eq.active&id=eq.${encodeURIComponent(pid)}&limit=1`);
      const p=rows?.[0]; if(!p)throw new Error("Produk checkout tidak ditemukan.");
      const stores=await sb(url,key,`/rest/v1/stores?select=id,name,owner_id,pickup_name,pickup_phone,pickup_address,pickup_postal_code,pickup_latitude,pickup_longitude,pickup_note&status=eq.active&id=eq.${encodeURIComponent(p.store_id)}&limit=1`);
      const store=stores?.[0]; if(!store)throw new Error("Toko produk tidak ditemukan.");
      if(!store.pickup_name||!store.pickup_phone||!store.pickup_address||!/^\\d{5}$/.test(String(store.pickup_postal_code||""))){
        throw new Error(`Alamat pickup toko "${store.name||"seller"}" belum lengkap. Seller harus melengkapi alamat pickup dan kode pos.`);
      }
      if(!groups.has(String(store.id)))groups.set(String(store.id),{store,items:[]});
      groups.get(String(store.id)).items.push({
        name:p.name,description:`Size ${size}`,category:"fashion",value:Number(p.price||0),quantity:qty,
        weight:Number(p.weight_gram||500),length:Number(p.length_cm||20),width:Number(p.width_cm||15),height:Number(p.height_cm||5)
      });
    }

    const courierList=String(body.couriers||"jne,jnt,sicepat,anteraja,wahana,tiki").trim();
    const selections=[];
    const sellerQuotes=[];
    for(const [storeId,g] of groups){
      const payload={origin_postal_code:Number(g.store.pickup_postal_code),destination_postal_code:Number(address.postal_code),couriers:courierList,items:g.items};
      if(g.store.pickup_latitude!=null&&g.store.pickup_longitude!=null){payload.origin_latitude=Number(g.store.pickup_latitude);payload.origin_longitude=Number(g.store.pickup_longitude);}
      const rate=await biteship(env,"/v1/rates/couriers",payload);
      const pricing=Array.isArray(rate?.pricing)?rate.pricing:[];
      if(!pricing.length)throw new Error(`Tidak ada layanan kurir tersedia untuk toko ${g.store.name||storeId}.`);
      const options=pricing.map(x=>({
        courier_company:x.company||x.courier_code,courier_name:x.courier_name||x.company,courier_type:x.type||x.courier_service_code,
        service_code:x.courier_service_code||x.type,service_name:x.courier_service_name||x.courier_service_code,
        price:Number(x.price||0),shipping_fee:Number(x.shipping_fee||x.price||0),duration:x.duration||null,
        collection_methods:x.available_collection_method||["pickup"]
      })).filter(x=>x.price>0);
      sellerQuotes.push({store_id:storeId,store_name:g.store.name,options});
    }

    return (()=>{
      const quoteId=crypto.randomUUID();
      const expires=new Date(Date.now()+15*60*1000).toISOString();
      const snapshot={buyer_id:buyer.id,address_id:addressId,address,items:rawItems};
      return sb(url,key,"/rest/v1/shipping_quotes",{
        method:"POST",headers:{Prefer:"return=representation"},
        body:JSON.stringify({id:quoteId,buyer_id:buyer.id,total_fee:0,status:"active",expires_at:expires,selections:sellerQuotes,request_snapshot:snapshot})
      }).then(()=>json({quote_id:quoteId,expires_at:expires,sellers:sellerQuotes},200));
    })();
  }catch(error){console.error("MarketKita shipping quote error:",error?.message||error);return json({error:error?.message||"Gagal menghitung ongkir."},500);}
}
