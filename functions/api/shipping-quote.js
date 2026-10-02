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
function rajaKey(env){return String(env.RAJAONGKIR_API_KEY||"").trim();}
async function raja(env,path,method="GET",body=null){
  const key=rajaKey(env);
  if(!key) throw new Error("RAJAONGKIR_API_KEY belum dipasang di Cloudflare.");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  let r;
  try{
    const headers={key,"Content-Type":"application/x-www-form-urlencoded"};
    r=await fetch("https://rajaongkir.komerce.id/api/v1"+path,{method,headers,body,signal:controller.signal});
  }catch(error){
    if(error?.name==="AbortError")throw new Error("RajaOngkir tidak merespons dalam 12 detik.");
    throw new Error("Gagal terhubung ke RajaOngkir: "+(error?.message||"network error"));
  }finally{clearTimeout(timer);}
  const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{};}catch{d={};}
  if(!r.ok||d?.meta?.status!=="success")throw new Error(d?.meta?.message||d?.message||("RajaOngkir gagal (HTTP "+r.status+")."));
  return d;
}
async function rajaDestination(env,postal){
  const d=await raja(env,"/destination/domestic-destination?search="+encodeURIComponent(postal)+"&limit=20&offset=0");
  const rows=Array.isArray(d?.data)?d.data:[];
  const exact=rows.find(x=>String(x.zip_code||"")===String(postal));
  const row=exact||rows[0];
  if(!row?.id)throw new Error("Kode pos "+postal+" tidak ditemukan di RajaOngkir.");
  return row;
}
export async function onRequestPost(context){
  try{
    const env=context.env, url=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""), key=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim(), anon=String(env.SUPABASE_ANON_KEY||"").trim();
    if(!url||!key)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
    const buyer=await user(context,url,anon); if(!buyer)return json({error:"Silakan login untuk menghitung ongkir."},401);
    const body=await context.request.json().catch(()=>({}));
    const addressId=String(body.address_id||"").trim();
    const manualRaw=body.manual_address&&typeof body.manual_address==="object"?body.manual_address:{};
    const manualAddress={
      recipient_name:String(manualRaw.recipient_name||"").trim(),
      phone:String(manualRaw.phone||"").trim(),
      address_line:String(manualRaw.address_line||"").trim(),
      city:String(manualRaw.city||"").trim(),
      province:String(manualRaw.province||"").trim(),
      district:String(manualRaw.district||"").trim(),
      subdistrict:String(manualRaw.subdistrict||"").trim(),
      postal_code:String(manualRaw.postal_code||"").trim(),
      destination_id:String(body.location?.destination_id||body.destination_id||"").trim(),
      province_id:String(body.location?.province_id||"").trim(),
      city_id:String(body.location?.city_id||"").trim(),
      district_id:String(body.location?.district_id||body.district_id||"").trim(),
      subdistrict_id:String(body.location?.subdistrict_id||"").trim(),
      district_id_for_calc:String(body.location?.district_id||"").trim()
    };
    const hasManual=Boolean(manualAddress.address_line||manualAddress.city||manualAddress.province||manualAddress.postal_code);
    const rawItems=Array.isArray(body.items)?body.items:[];
    if((!addressId&&!hasManual)||!rawItems.length)return json({error:"Alamat dan keranjang wajib diisi."},400);
    if(addressId&&hasManual)return json({error:"Pilih alamat tersimpan atau isi alamat manual, bukan keduanya."},400);

    let address=null;
    if(addressId){
      const addresses=await sb(url,key,`/rest/v1/buyer_addresses?select=id,recipient_name,phone,address_line,city,province,postal_code&user_id=eq.${encodeURIComponent(buyer.id)}&id=eq.${encodeURIComponent(addressId)}&limit=1`);
      address=addresses?.[0];
      if(!address)return json({error:"Alamat pengiriman tidak ditemukan."},400);
    }else{
      address={...manualAddress};
    }
    if(!address.address_line||!address.city||!address.province||!/^\d{5}$/.test(String(address.postal_code||""))){
      return json({error:"Alamat manual wajib berisi alamat lengkap, kota, provinsi, dan kode pos 5 digit."},400);
    }
    if(address.phone&&!/^[0-9+][0-9 ()-]{7,19}$/.test(String(address.phone))){
      return json({error:"Nomor WhatsApp alamat tidak valid."},400);
    }

        const groups=new Map();
    for(const raw of rawItems){
      const pid=String(raw.product_id||"").trim(), size=String(raw.size||"").trim().toUpperCase(), qty=Number(raw.quantity);
      if(!pid||!size||!Number.isInteger(qty)||qty<1||qty>99)throw new Error("Data item checkout tidak valid.");
      const rows=await sb(url,key,`/rest/v1/products?select=id,store_id,name,price,weight_gram,length_cm,width_cm,height_cm&status=eq.active&id=eq.${encodeURIComponent(pid)}&limit=1`);
      const p=rows?.[0]; if(!p)throw new Error("Produk checkout tidak ditemukan.");
      const stores=await sb(url,key,`/rest/v1/stores?select=id,name,owner_id,pickup_name,pickup_phone,pickup_address,pickup_postal_code,pickup_latitude,pickup_longitude,pickup_note&status=eq.active&id=eq.${encodeURIComponent(p.store_id)}&limit=1`);
      const store=stores?.[0]; if(!store)throw new Error("Toko produk tidak ditemukan.");
      if(!store.pickup_name||!store.pickup_phone||!store.pickup_address||!/^\d{5}$/.test(String(store.pickup_postal_code||""))){
        throw new Error(`Alamat pickup toko "${store.name||"seller"}" belum lengkap. Seller harus melengkapi alamat pickup dan kode pos.`);
      }
      if(!groups.has(String(store.id)))groups.set(String(store.id),{store,items:[]});
      groups.get(String(store.id)).items.push({
        name:p.name,description:`Size ${size}`,category:"fashion",value:Number(p.price||0),quantity:qty,
        weight:Number(p.weight_gram||500),length:Number(p.length_cm||20),width:Number(p.width_cm||15),height:Number(p.height_cm||5)
      });
    }

    const courierList=String(body.couriers||"jne:sicepat:jnt:ninja:tiki:lion:anteraja:pos:wahana").trim().replace(/,/g,":");
    const selections=[];
    const sellerQuotes=[];
    for(const [storeId,g] of groups){
      const origin=await rajaDestination(env,String(g.store.pickup_postal_code));
      const destinationId=String(address.destination_id||"").trim();
      const districtIdForCalc=String(address.district_id_for_calc||"").trim();
      const weight=Math.max(1,Math.ceil(g.items.reduce((sum,item)=>sum+Number(item.weight||500)*Number(item.quantity||1),0)));
      const makeCostForm=(dest)=>{const form=new URLSearchParams();form.set("origin",String(origin.id));form.set("destination",String(dest.id));form.set("weight",String(weight));form.set("courier",courierList);form.set("price","lowest");return form.toString();};
      const makeDistrictCostForm=()=>{const form=new URLSearchParams();form.set("origin",String(origin.id));form.set("destination",districtIdForCalc);form.set("weight",String(weight));form.set("courier",courierList);form.set("price","lowest");return form.toString();};
      let rate;
      // If the picker supplies a RajaOngkir-compatible destination ID, use
      // the precise subdistrict calculation. Otherwise use the selected
      // district ID, which is also a supported calculation level.
      if(districtIdForCalc){
        try{
          rate=await raja(env,"/calculate/district/domestic-cost","POST",makeDistrictCostForm());
        }catch(districtError){
          const destination=destinationId
            ? {id:destinationId,zip_code:address.postal_code}
            : await rajaDestination(env,String(address.postal_code));
          rate=await raja(env,"/calculate/domestic-cost","POST",makeCostForm(destination));
        }
      }else{
        const destination=destinationId
          ? {id:destinationId,zip_code:address.postal_code}
          : await rajaDestination(env,String(address.postal_code));
        rate=await raja(env,"/calculate/domestic-cost","POST",makeCostForm(destination));
      }
      const pricing=Array.isArray(rate?.data)?rate.data:[];
      if(!pricing.length)throw new Error("Tidak ada layanan kurir tersedia untuk toko "+(g.store.name||storeId)+".");
      const options=pricing.map(x=>({
        courier_company:x.code||x.name,courier_name:x.name||x.code,courier_type:x.service||x.code,
        service_code:x.service||x.code,service_name:x.service||x.code,
        price:Number(x.cost||0),shipping_fee:Number(x.cost||0),duration:x.etd||null,
        collection_methods:["pickup"]
      })).filter(x=>x.price>0);
      sellerQuotes.push({store_id:storeId,store_name:g.store.name,options});
    }

    return (()=>{
      const quoteId=crypto.randomUUID();
      const expires=new Date(Date.now()+15*60*1000).toISOString();
      const totalFee=sellerQuotes.reduce((sum,seller)=>sum+Math.min(...(seller.options||[]).map(o=>Number(o.price||0)).filter(Number.isFinite)),0);
      const snapshot={
        buyer_id:buyer.id,
        address_id:addressId||null,
        manual_address:addressId?null:{recipient_name:String(address.recipient_name||""),phone:String(address.phone||""),address_line:String(address.address_line||""),city:String(address.city||""),province:String(address.province||""),district:String(address.district||""),subdistrict:String(address.subdistrict||""),postal_code:String(address.postal_code||"")},
        postal_code:String(address.postal_code||""),
        items:rawItems.map(item=>({
          product_id:String(item.product_id||""),
          size:String(item.size||"").trim().toUpperCase(),
          quantity:Number(item.quantity||0)
        }))
      };
      return sb(url,key,"/rest/v1/shipping_quotes",{
        method:"POST",headers:{Prefer:"return=representation"},
        body:JSON.stringify({id:quoteId,buyer_id:buyer.id,total_fee:totalFee,status:"active",expires_at:expires,selections:sellerQuotes,request_snapshot:snapshot})
      }).then(()=>json({quote_id:quoteId,expires_at:expires,total_fee:totalFee,sellers:sellerQuotes},200));
    })();
  }catch(error){console.error("MarketKita shipping quote error:",error?.message||error);return json({error:error?.message||"Gagal menghitung ongkir."},500);}
}
