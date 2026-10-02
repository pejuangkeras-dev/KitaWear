function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
const int=v=>Number.isFinite(Number(v))?Math.round(Number(v)):0;
function sh(k){return{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){
  const r=await fetch(u+p,{...o,headers:{...sh(k),...(o.headers||{})}});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}
  if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);
  return d;
}
async function authUser(request,u,a){
  const h=request.headers.get("Authorization")||"";
  if(!/^Bearer\\s+/i.test(h))return null;
  const r=await fetch(u+"/auth/v1/user",{headers:{apikey:a,Authorization:h}});
  if(!r.ok)return null;
  const d=await r.json().catch(()=>null);
  return d?.id?d:null;
}
function courierName(v){
  const s=clean(v).toLowerCase();
  const map=[["j&t","J&T"],["jnt","J&T"],["jne","JNE"],["sicepat","SICEPAT"],["si cepat","SICEPAT"],["sap","SAP"],["idexpress","IDEXPRESS"],["ide","IDEXPRESS"],["ninja","NINJA"],["lion","LION"],["pos","POS"],["spx","SPX"],["tiki","TIKI"],["wahana","WAHANA"],["anteraja","ANTERAJA"]];
  const hit=map.find(([needle])=>s.includes(needle));
  return hit?hit[1]:clean(v).split(/\\s+/)[0].toUpperCase();
}
function serviceType(selection){
  const raw=clean(selection?.service_code||selection?.service_name||selection?.courier_type);
  const upper=raw.toUpperCase();
  if(/REG/.test(upper))return upper.includes("REG23")?"REG23":upper.includes("REG19")?"REG19":upper.includes("REGULER")?"REGULER":"REG";
  if(/\\bECO\\b/.test(upper))return"ECO";
  if(/\\bEZ\\b/.test(upper))return"EZ";
  if(/\\bGOKIL\\b/.test(upper))return"GOKIL";
  if(/\\bINSTANT\\b/.test(upper))return"INSTANT";
  const cleaned=upper.replace(/[^A-Z0-9_-]/g,"");
  return cleaned||"REG";
}
async function destination(base,key,keyword){
  const q=new URLSearchParams({keyword:clean(keyword)});
  const r=await fetch(base+"/tariff/api/v1/destination/search?"+q.toString(),{headers:{"x-api-key":key}});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}
  if(!r.ok||!d.meta||d.meta.status!=="success")throw new Error(d.meta?.message||"Gagal mencari destination RajaOngkir.");
  const rows=Array.isArray(d.data)?d.data:[];
  return rows.find(x=>clean(x.zip_code)===clean(keyword))||rows[0]||null;
}
async function komerce(base,key,path,body){
  const r=await fetch(base+path,{method:"POST",headers:{"x-api-key":key,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(body)});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}
  if(!r.ok||!d.meta||d.meta.status!=="success")throw new Error(d.meta?.message||d.message||"Komerce gagal membuat order pengiriman.");
  return d;
}
export async function onRequestPost(context){
 try{
  const e=context.env,u=clean(e.SUPABASE_URL).replace(/\/+$/,""),k=clean(e.SUPABASE_SERVICE_ROLE_KEY),a=clean(e.SUPABASE_ANON_KEY),apiKey=clean(e.RAJAONGKIR_DELIVERY_API_KEY),base=clean(e.RAJAONGKIR_DELIVERY_BASE_URL)||"https://api-sandbox.collaborator.komerce.id";
  if(!u||!k||!a)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
  const user=await authUser(context.request,u,a);if(!user)return json({error:"Silakan login sebagai seller."},401);
  if(!apiKey)return json({error:"RAJAONGKIR_DELIVERY_API_KEY belum dipasang di Cloudflare. Gunakan API key Shipping Delivery, bukan Shipping Cost."},500);
  const body=await context.request.json().catch(()=>({})),orderId=clean(body.order_id),requestedSellerId=clean(body.order_seller_id);
  if(!orderId)return json({error:"order_id wajib."},400);
  const profile=await sb(u,k,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(user.id)+"&limit=1"),role=clean(profile?.[0]?.role).toLowerCase(),isAdmin=role==="admin";
  if(!["seller","admin"].includes(role))return json({error:"Akses ditolak. Akun harus seller atau admin."},403);
  const orders=await sb(u,k,"/rest/v1/orders?select=id,order_number,buyer_id,customer_name,customer_email,customer_phone,shipping_address,shipping_postal_code,shipping_selections,status,payment_status&id=eq."+encodeURIComponent(orderId)+"&limit=1"),order=orders?.[0];
  if(!order)return json({error:"Pesanan tidak ditemukan."},404);
  if(order.payment_status!=="paid")return json({error:"Pengiriman hanya dapat dibuat untuk pesanan yang sudah dibayar."},409);
  const sellerQuery = requestedSellerId
    ? "/rest/v1/order_sellers?select=id,order_id,store_id,seller_id,subtotal,shipping_fee,total,seller_status,shipping_status,tracking_number&id=eq."+encodeURIComponent(requestedSellerId)+"&order_id=eq."+encodeURIComponent(orderId)+"&limit=1"
    : "/rest/v1/order_sellers?select=id,order_id,store_id,seller_id,subtotal,shipping_fee,total,seller_status,shipping_status,tracking_number&seller_id=eq."+encodeURIComponent(user.id)+"&order_id=eq."+encodeURIComponent(orderId)+"&limit=1";
  const sellers=await sb(u,k,sellerQuery),seller=sellers?.[0];
  if(!seller)return json({error:"Data order seller tidak ditemukan."},404);
  if(!isAdmin&&String(seller.seller_id)!==String(user.id))return json({error:"Akses ditolak."},403);
  if(!["processing","paid"].includes(clean(seller.seller_status)))return json({error:"Order seller harus berada pada status paid atau processing sebelum membuat pengiriman."},409);
  if(clean(seller.tracking_number))return json({ok:true,already_created:true,waybill_id:clean(seller.tracking_number)});
  const existing=await sb(u,k,"/rest/v1/shipping_shipments?select=id,provider,provider_order_id,provider_tracking_id,waybill_id,status,raw_response&order_seller_id=eq."+encodeURIComponent(seller.id)+"&limit=1");
  const existingShipment=existing?.[0];if(existingShipment?.provider_order_id||existingShipment?.waybill_id)return json({ok:true,already_created:true,shipment:existingShipment});
  const stores=await sb(u,k,"/rest/v1/stores?select=id,name,pickup_name,pickup_phone,pickup_address,pickup_postal_code,pickup_latitude,pickup_longitude,owner_id&id=eq."+encodeURIComponent(seller.store_id)+"&limit=1"),store=stores?.[0];
  if(!store)return json({error:"Data alamat pickup toko belum lengkap."},409);
  const originPostal=clean(store.pickup_postal_code),destinationPostal=clean(order.shipping_postal_code);
  if(!originPostal||!destinationPostal)return json({error:"Kode pos pickup toko atau alamat buyer belum tersedia."},409);
  const origin=await destination(base,apiKey,originPostal),receiver=await destination(base,apiKey,destinationPostal);
  if(!origin?.id||!receiver?.id)return json({error:"Destination RajaOngkir tidak ditemukan untuk kode pos pickup/penerima."},422);
  const items=await sb(u,k,"/rest/v1/order_items?select=id,product_id,product_name,size,quantity,unit_price,line_total&order_id=eq."+encodeURIComponent(orderId)+"&store_id=eq."+encodeURIComponent(seller.store_id)+"&order=created_at.asc");
  if(!items?.length)return json({error:"Item pesanan seller tidak ditemukan."},404);
  const ids=[...new Set(items.map(x=>x.product_id).filter(Boolean))];
  const products=await sb(u,k,"/rest/v1/products?select=id,name,weight_gram,length_cm,width_cm,height_cm&id=in.("+ids.map(encodeURIComponent).join(",")+")"),pmap=new Map((products||[]).map(x=>[String(x.id),x]));
  const details=items.map(item=>{const p=pmap.get(String(item.product_id))||{},weight=int(p.weight_gram),width=Number(p.width_cm),height=Number(p.height_cm),length=Number(p.length_cm);if(weight<=0||!(width>0)||!(height>0)||!(length>0))throw new Error("Dimensi/berat produk "+clean(item.product_name)+" belum lengkap.");return{product_name:clean(item.product_name),product_variant_name:clean(item.size)||"Default",product_price:int(item.unit_price),product_weight:weight,product_width:width,product_height:height,product_length:length,qty:int(item.quantity),subtotal:int(item.line_total)};});
  const selections=Array.isArray(order.shipping_selections)?order.shipping_selections:[],selection=selections.find(x=>String(x.store_id)===String(seller.store_id))||{},shippingCost=int(selection.price||seller.shipping_fee),courier=courierName(selection.courier_company||selection.courier_type||selection.service_name),shippingType=serviceType(selection),subtotal=details.reduce((s,x)=>s+x.subtotal,0),grandTotal=subtotal+shippingCost;
  const authSeller=await fetch(u+"/auth/v1/admin/users/"+encodeURIComponent(seller.seller_id),{headers:{apikey:k,Authorization:"Bearer "+k}}),authData=authSeller.ok?await authSeller.json().catch(()=>null):null,shipperEmail=clean(e.RAJAONGKIR_SHIPPER_EMAIL)||clean(authData?.email)||"shipping@marketkita.pages.dev";
  const shipperPhone=clean(store.pickup_phone).replace(/[^0-9]/g,""),receiverPhone=clean(order.customer_phone).replace(/[^0-9]/g,"");if(!shipperPhone||!receiverPhone)return json({error:"Nomor telepon pickup atau buyer belum tersedia."},422);
  const payload={order_date:new Date().toISOString().slice(0,10),brand_name:"MarketKita",shipper_name:clean(store.pickup_name)||clean(store.name)||"MarketKita Seller",shipper_phone:shipperPhone,shipper_destination_id:int(origin.id),shipper_address:clean(store.pickup_address),receiver_name:clean(order.customer_name)||"Buyer MarketKita",receiver_phone:receiverPhone,receiver_destination_id:int(receiver.id),receiver_address:clean(order.shipping_address),receiver_email:clean(order.customer_email)||undefined,shipper_email:shipperEmail,shipping:courier,shipping_type:shippingType,payment_method:"BANK TRANSFER",shipping_cost:shippingCost,shipping_cashback:0,service_fee:0,additional_cost:0,grand_total:grandTotal,cod_value:0,insurance_value:0,notes:"MarketKita order "+clean(order.order_number),order_details:details};
  Object.keys(payload).forEach(key=>payload[key]===undefined&&delete payload[key]);
  const result=await komerce(base,apiKey,"/order/api/v1/orders/store",payload),data=result.data||{};if(!data.order_no)return json({error:"Komerce tidak mengembalikan order_no."},502);
  const detailRes=await fetch(base+"/order/api/v1/orders/detail?order_no="+encodeURIComponent(data.order_no),{headers:{"x-api-key":apiKey}}),detailText=await detailRes.text();let detailData={};try{detailData=detailText?JSON.parse(detailText):{};}catch{}
  const awb=clean(detailData?.data?.awb||detailData?.data?.airway_bill||data.awb||""),providerStatus=clean(detailData?.data?.order_status||"Diajukan");
  const row={order_seller_id:seller.id,order_id:order.id,provider:"rajaongkir_delivery",provider_order_id:String(data.order_no),provider_tracking_id:String(data.order_id||""),waybill_id:awb||null,courier_company:courier,courier_type:shippingType,status:providerStatus,shipping_fee:shippingCost,tracking_url:clean(detailData?.data?.live_tracking_url)||null,raw_response:{create:result,detail:detailData},last_webhook_at:new Date().toISOString()};
  let shipmentRow;
  if(existingShipment?.id){const z=await sb(u,k,"/rest/v1/shipping_shipments?id=eq."+encodeURIComponent(existingShipment.id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});shipmentRow=z?.[0]||null;}
  else{const z=await sb(u,k,"/rest/v1/shipping_shipments",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});shipmentRow=z?.[0]||null;}
  if(awb){
    await sb(u,k,"/rest/v1/order_sellers?id=eq."+encodeURIComponent(seller.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({tracking_number:awb,shipping_status:"shipped",seller_status:"shipped",updated_at:new Date().toISOString()})});
    const all=await sb(u,k,"/rest/v1/order_sellers?select=id,shipping_status&order_id=eq."+encodeURIComponent(order.id)),rows=Array.isArray(all)?all:[],allShipped=rows.length>0&&rows.every(x=>["shipped","delivered"].includes(String(x.shipping_status||"")));
    if(allShipped&&["paid","processing"].includes(String(order.status||"")))await sb(u,k,"/rest/v1/orders?id=eq."+encodeURIComponent(order.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"shipped",shipping_status:"shipped",shipped_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
  }
  return json({ok:true,order_id:order.id,order_seller_id:seller.id,provider_order_no:data.order_no,provider_order_id:data.order_id||null,waybill_id:awb||null,courier,shipping_type:shippingType,shipment:shipmentRow});
 }catch(e){console.error("MarketKita shipping create:",e?.message||e);return json({error:e?.message||"Gagal membuat pengiriman."},500);}
}
export async function onRequestGet(context){const base=clean(context.env.RAJAONGKIR_DELIVERY_BASE_URL)||"https://api-sandbox.collaborator.komerce.id";const key=clean(context.env.RAJAONGKIR_DELIVERY_API_KEY);const normalized=base.toLowerCase();const sandbox=normalized.includes("sandbox")||normalized.includes("collaborator.komerce.id");return json({ok:true,service:"MarketKita RajaOngkir Delivery Create",mode:sandbox?"sandbox":"production",configured:Boolean(key),safe_to_create:Boolean(key)&&!sandbox});}