function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
function h(k){return{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...h(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
function mapStatus(v){
  const s=clean(v).toLowerCase();
  if(["diajukan","confirmed","scheduled","allocated","picking_up","pickup","diproses","processing"].includes(s))return"processing";
  if(["dijemput","dikirim","picked","in_transit","dropping_off","shipped","transit"].includes(s))return"shipped";
  if(["selesai","delivered","diterima","completed"].includes(s))return"delivered";
  if(["dibatalkan","cancelled","rejected","returned","return","dikembalikan","disposed","failed"].includes(s))return"cancelled";
  return"processing";
}
export async function onRequest(context){
  if(context.request.method==="GET")return json({ok:true,service:"MarketKita RajaOngkir Webhook"});
  if(!["POST","PUT"].includes(context.request.method))return json({error:"Method not allowed"},405);
  try{
    const env=context.env,u=clean(env.SUPABASE_URL).replace(/\/+$/,""),k=clean(env.SUPABASE_SERVICE_ROLE_KEY);
    const secret=clean(env.RAJAONGKIR_WEBHOOK_SECRET||env.BITESHIP_WEBHOOK_SECRET);
    const configuredHeader=clean(env.RAJAONGKIR_WEBHOOK_HEADER)||"X-MarketKita-Shipping-Secret";
    if(!u||!k||!secret)return json({error:"Konfigurasi webhook shipping belum lengkap."},500);
    if(context.request.headers.get(configuredHeader)!==secret)return json({error:"Unauthorized"},401);
    const body=await context.request.json().catch(()=>({}));
    const orderNo=clean(body.order_no||body.order_id);
    const awb=clean(body.cnote||body.awb||body.airway_bill||body.courier_waybill_id);
    const incomingStatus=clean(body.status||body.order_status||body.event);
    if(!orderNo&&!awb)return json({ok:true,ignored:true});
    let rows=[];
    if(orderNo)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id&provider_order_id=eq.${encodeURIComponent(orderNo)}&limit=1`);
    if(!rows.length&&awb)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id&waybill_id=eq.${encodeURIComponent(awb)}&limit=1`);
    if(!rows.length)return json({ok:true,ignored:true});
    const shipment=rows[0],marketStatus=mapStatus(incomingStatus);
    const patch={status:incomingStatus||marketStatus,waybill_id:awb||null,last_webhook_at:new Date().toISOString(),raw_response:body};
    if(!awb){patch.waybill_id=undefined;delete patch.waybill_id;}
    await sb(u,k,`/rest/v1/shipping_shipments?id=eq.${encodeURIComponent(shipment.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
    await sb(u,k,`/rest/v1/order_sellers?id=eq.${encodeURIComponent(shipment.order_seller_id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({
      shipping_status:marketStatus,
      ...(awb?{tracking_number:awb}:{}),
      seller_status:marketStatus==="delivered"?"completed":marketStatus
    })});
    const sellers=await sb(u,k,`/rest/v1/order_sellers?select=id,seller_status,shipping_status&order_id=eq.${encodeURIComponent(shipment.order_id)}`);
    const sellerRows=Array.isArray(sellers)?sellers:[];
    const allShipped=sellerRows.length>0&&sellerRows.every(x=>["shipped","delivered","completed"].includes(clean(x.shipping_status)));
    const allDelivered=sellerRows.length>0&&sellerRows.every(x=>clean(x.shipping_status)==="delivered");
    const orderPatch={shipping_status:allDelivered?"delivered":allShipped?"shipped":"processing",updated_at:new Date().toISOString()};
    if(allDelivered){orderPatch.status="delivered";orderPatch.delivered_at=new Date().toISOString();}
    else if(allShipped){orderPatch.status="shipped";orderPatch.shipped_at=new Date().toISOString();}
    await sb(u,k,`/rest/v1/orders?id=eq.${encodeURIComponent(shipment.order_id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(orderPatch)});
    return json({ok:true,order_no:orderNo,waybill_id:awb,market_status:marketStatus});
  }catch(e){console.error("MarketKita RajaOngkir webhook:",e?.message||e);return json({error:e?.message||"Webhook gagal diproses."},500);}
}