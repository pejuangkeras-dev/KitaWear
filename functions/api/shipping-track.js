function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
function sh(k){return{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...sh(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d.message||d.details||d.hint||d.error||"Supabase request gagal.");return d;}
async function getUser(c,u,a){const h=c.request.headers.get("Authorization")||"";if(!h.toLowerCase().startsWith("bearer "))return null;const r=await fetch(u+"/auth/v1/user",{headers:{apikey:a,Authorization:h}});if(!r.ok)return null;const d=await r.json().catch(()=>null);return d&&d.id?d:null;}
function courierCode(v){const s=clean(v).toLowerCase().replace(/[^a-z0-9]+/g," ");const a=[["sicepat","sicepat"],["si cepat","sicepat"],["j&t","jnt"],["jnt","jnt"],["jne","jne"],["ninja","ninja"],["tiki","tiki"],["lion","lion"],["wahana","wahana"],["pos","pos"],["sap","sap"],["spx","spx"],["ide","ide"],["idexpress","ide"],["anteraja","anteraja"]];const h=a.find(x=>s.includes(x[0]));return h?h[1]:(s.split(" ")[0]||"");}
function marketStatus(s,d){if(d)return"delivered";s=clean(s).toLowerCase();if(/return|returned|cancel|failed|reject/.test(s))return"cancelled";if(/deliver/.test(s))return"delivered";if(/transit|ship|pickup|picked|manifest|process|received/.test(s))return"shipped";return"processing";}
function normalizeTracking(data,{shipment,choice,awb,courier,isDelivery}){
 const tracking=data?.data||{}, base=tracking.summary||{}, delivery=tracking.delivery_status||{}; let summary=base,timeline=[];
 if(isDelivery){
   summary={courier_name:tracking.shipping||tracking.courier||((choice&&choice.courier_company)||(shipment&&shipment.courier_company)||courier),service_code:tracking.shipping_type||((choice&&choice.service_code)||(shipment&&shipment.courier_type)||null),waybill_number:tracking.awb||tracking.airway_bill||awb,status:tracking.order_status||tracking.status||"tracking",origin:tracking.shipper_address||null,destination:tracking.receiver_address||null};
   if(Array.isArray(tracking.history))timeline=tracking.history.map(x=>({code:clean(x.status||x.code),description:clean(x.description||x.message),date:clean(x.date||x.created_at),time:clean(x.time),city:clean(x.city||x.city_name)}));
 }else if(Array.isArray(tracking.manifest))timeline=tracking.manifest.map(x=>({code:clean(x.manifest_code),description:clean(x.manifest_description),date:clean(x.manifest_date),time:clean(x.manifest_time),city:clean(x.city_name)}));
 const status=summary.status||delivery.status||"tracking";
 return {tracking,summary,delivery,timeline,status,market:marketStatus(status,Boolean(tracking.delivered))};
}
export async function onRequestPost(context){try{
 const e=context.env,u=clean(e.SUPABASE_URL).replace(/\/+$/,""),k=clean(e.SUPABASE_SERVICE_ROLE_KEY),a=clean(e.SUPABASE_ANON_KEY),rk=clean(e.RAJAONGKIR_API_KEY);
 if(!u||!k||!a)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
 const user=await getUser(context,u,a);if(!user)return json({error:"Silakan login untuk melacak pesanan."},401);
 const body=await context.request.json().catch(()=>({})),orderId=clean(body.order_id),requestedSellerId=clean(body.order_seller_id);
 if(!orderId)return json({error:"order_id wajib."},400);
 const orders=await sb(u,k,"/rest/v1/orders?select=id,order_number,buyer_id,customer_phone,shipping_selections,status,payment_status,shipping_status,shipped_at,delivered_at&id=eq."+encodeURIComponent(orderId)+"&limit=1"),order=orders&&orders[0];
 if(!order)return json({error:"Pesanan tidak ditemukan."},404);
 const profiles=await sb(u,k,"/rest/v1/profiles?select=id,role&id=eq."+encodeURIComponent(user.id)+"&limit=1"),role=clean(profiles&&profiles[0]&&profiles[0].role).toLowerCase(),isAdmin=role==="admin",isBuyer=String(order.buyer_id)===String(user.id);
 const sellers=requestedSellerId?await sb(u,k,"/rest/v1/order_sellers?select=id,order_id,seller_id,store_id,tracking_number,shipping_status&id=eq."+encodeURIComponent(requestedSellerId)+"&order_id=eq."+encodeURIComponent(orderId)+"&limit=1"):await sb(u,k,"/rest/v1/order_sellers?select=id,order_id,seller_id,store_id,tracking_number,shipping_status&order_id=eq."+encodeURIComponent(orderId));
 if(!sellers?.length)return json({error:"Data pengiriman seller tidak ditemukan."},404);
 const requested=sellers[0];if(!isAdmin&&!isBuyer&&!sellers.some(x=>String(x.seller_id)===String(user.id)))return json({error:"Akses ditolak."},403);
 const shipments=await sb(u,k,"/rest/v1/shipping_shipments?select=id,order_seller_id,order_id,provider,provider_order_id,waybill_id,courier_company,courier_type,status,tracking_url,raw_response,updated_at,tracking_checked_at,delivered_at,delivery_recipient&order_seller_id=eq."+encodeURIComponent(requested.id)+"&limit=1"),shipment=shipments&&shipments[0];
 const awb=clean(requested.tracking_number||(shipment&&shipment.waybill_id));if(!awb)return json({error:"Nomor resi belum tersedia."},400);
 const selected=Array.isArray(order.shipping_selections)?order.shipping_selections:[],choice=selected.find(x=>String(x.store_id)===String(requested.store_id)),courier=courierCode((choice&&choice.courier_company)||(shipment&&shipment.courier_company));
 if(!courier)return json({error:"Kode kurir tidak dapat ditentukan."},400);
 const isDelivery=String(shipment?.provider||"")==="rajaongkir_delivery"&&clean(e.RAJAONGKIR_DELIVERY_API_KEY)&&clean(shipment?.provider_order_id);
 const cached=shipment?.raw_response&&typeof shipment.raw_response==="object"&&Object.keys(shipment.raw_response).length>0;
 const checkedAt=shipment?.tracking_checked_at?Date.parse(shipment.tracking_checked_at):0;
 const cacheFresh=checkedAt>0&&(Date.now()-checkedAt)<60000;
 if(cached&&cacheFresh){
   const n=normalizeTracking(shipment.raw_response,{shipment,choice,awb,courier,isDelivery});
   return json({ok:true,source:"cache",stale:false,order_id:order.id,order_seller_id:requested.id,shipment,tracking:{courier_code:n.summary.courier_code||courier,courier_name:n.summary.courier_name||(choice&&choice.courier_company)||(shipment&&shipment.courier_company)||courier,waybill_number:n.summary.waybill_number||awb,service_code:n.summary.service_code||(choice&&choice.courier_type)||(shipment&&shipment.courier_type)||null,status:n.summary.status||n.delivery.status||shipment.status,delivered:Boolean(n.tracking.delivered||shipment.delivered_at),receiver:n.delivery.pod_receiver||shipment.delivery_recipient||null,pod_date:n.delivery.pod_date||shipment.delivered_at||null,pod_time:n.delivery.pod_time||null,origin:n.summary.origin||null,destination:n.summary.destination||null,timeline:n.timeline}});
 }
 let data={},responseStatus=200,providerError=null;
 try{
   if(isDelivery){
     const deliveryKey=clean(e.RAJAONGKIR_DELIVERY_API_KEY),deliveryBase=clean(e.RAJAONGKIR_DELIVERY_BASE_URL)||"https://api-sandbox.collaborator.komerce.id";
     const detailUrl=deliveryBase+"/order/api/v1/orders/detail?order_no="+encodeURIComponent(shipment.provider_order_id);
     const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
     try{const r=await fetch(detailUrl,{headers:{"x-api-key":deliveryKey},signal:ctrl.signal});responseStatus=r.status;const t=await r.text();try{data=t?JSON.parse(t):{};}catch{data={};}}
     finally{clearTimeout(timer);}
     if(responseStatus>=400||!data.meta||data.meta.status!=="success")throw new Error(data.meta?.message||"Status shipment RajaOngkir Delivery belum tersedia.");
   }else{
     if(!rk) return json({error:"RAJAONGKIR_API_KEY belum dipasang di Cloudflare."},500);
     const phone=clean(order.customer_phone).replace(/\D/g,""),qs=new URLSearchParams({awb:awb,courier:courier});if(phone)qs.set("last_phone_number",phone.slice(-5));
     const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);let response;
     try{response=await fetch("https://rajaongkir.komerce.id/api/v1/track/waybill?"+qs.toString(),{method:"POST",headers:{key:rk},signal:ctrl.signal});responseStatus=response.status;const t=await response.text();try{data=t?JSON.parse(t):{};}catch{data={};}}
     finally{clearTimeout(timer);}
     if(responseStatus>=400||!data.meta||data.meta.status!=="success")throw new Error((data.meta&&data.meta.message)||data.message||"Resi belum dapat dilacak. Pastikan nomor resi dan kurir benar.");
   }
 }catch(err){providerError=err;}
 if(providerError){
   if(cached){
     const n=normalizeTracking(shipment.raw_response,{shipment,choice,awb,courier,isDelivery});
     return json({ok:true,source:"cache",stale:true,provider_error:providerError.message,order_id:order.id,order_seller_id:requested.id,shipment,tracking:{courier_code:n.summary.courier_code||courier,courier_name:n.summary.courier_name||(choice&&choice.courier_company)||(shipment&&shipment.courier_company)||courier,waybill_number:n.summary.waybill_number||awb,service_code:n.summary.service_code||(choice&&choice.courier_type)||(shipment&&shipment.courier_type)||null,status:n.summary.status||n.delivery.status||shipment.status,delivered:Boolean(n.tracking.delivered||shipment.delivered_at),receiver:n.delivery.pod_receiver||shipment.delivery_recipient||null,pod_date:n.delivery.pod_date||shipment.delivered_at||null,pod_time:n.delivery.pod_time||null,origin:n.summary.origin||null,destination:n.summary.destination||null,timeline:n.timeline}});
   }
   throw providerError;
 }
 const n=normalizeTracking(data,{shipment,choice,awb,courier,isDelivery}),ms=n.market,patch={provider:String(shipment?.provider||"rajaongkir"),waybill_id:awb,courier_company:n.summary.courier_name||(choice&&choice.courier_company)||(shipment&&shipment.courier_company)||courier,courier_type:n.summary.service_code||(choice&&choice.courier_type)||(shipment&&shipment.courier_type)||null,status:String(n.summary.status||n.delivery.status||"tracking").toLowerCase(),last_webhook_at:new Date().toISOString(),tracking_checked_at:new Date().toISOString(),raw_response:data};
 let shipmentRow=shipment;
 if(shipment){const z=await sb(u,k,"/rest/v1/shipping_shipments?id=eq."+encodeURIComponent(shipment.id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});shipmentRow=z&&z[0]||Object.assign({},shipment,patch);}
 else{const z=await sb(u,k,"/rest/v1/shipping_shipments",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({order_seller_id:requested.id,order_id:order.id,provider:"rajaongkir",waybill_id:awb,courier_company:patch.courier_company,courier_type:patch.courier_type,status:patch.status,shipping_fee:0,raw_response:data,last_webhook_at:new Date().toISOString(),tracking_checked_at:new Date().toISOString()})});shipmentRow=z&&z[0]||null;}
 const sellerPatch={shipping_status:ms,tracking_number:awb,seller_status:ms==="delivered"?"completed":ms==="shipped"?"shipped":ms==="cancelled"?"cancelled":"processing"};await sb(u,k,"/rest/v1/order_sellers?id=eq."+encodeURIComponent(requested.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(sellerPatch)});
 const all=await sb(u,k,"/rest/v1/order_sellers?select=id,seller_status,shipping_status&order_id=eq."+encodeURIComponent(order.id)),rows=Array.isArray(all)?all:[],allShipped=rows.length>0&&rows.every(x=>["shipped","delivered","completed"].includes(String(x.shipping_status||""))),allDelivered=rows.length>0&&rows.every(x=>["delivered","completed"].includes(String(x.shipping_status||"")));
 const op={shipping_status:allDelivered?"delivered":allShipped?"shipped":"processing",updated_at:new Date().toISOString()};
 if(allDelivered&&["paid","processing","shipped","delivered"].includes(order.status)){op.status="delivered";op.delivered_at=order.delivered_at||new Date().toISOString();}
 else if(allShipped&&["paid","processing"].includes(order.status)){op.status="shipped";op.shipped_at=order.shipped_at||new Date().toISOString();}
 await sb(u,k,"/rest/v1/orders?id=eq."+encodeURIComponent(order.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(op)});
 return json({ok:true,source:"provider",stale:false,order_id:order.id,order_seller_id:requested.id,shipment:shipmentRow,tracking:{courier_code:n.summary.courier_code||courier,courier_name:n.summary.courier_name||patch.courier_company,waybill_number:n.summary.waybill_number||awb,service_code:n.summary.service_code||patch.courier_type,status:n.summary.status||n.delivery.status||patch.status,delivered:Boolean(n.tracking.delivered),receiver:n.delivery.pod_receiver||null,pod_date:n.delivery.pod_date||null,pod_time:n.delivery.pod_time||null,origin:n.summary.origin||null,destination:n.summary.destination||null,timeline:n.timeline}});
}catch(e){console.error("MarketKita shipping tracking:",e&&e.message||e);return json({error:e&&e.message||"Gagal melacak resi."},500);}}
export async function onRequestGet(){return json({ok:true,service:"MarketKita RajaOngkir Tracking"});}
