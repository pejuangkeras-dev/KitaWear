function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
function h(k){return{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...h(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
function mapStatus(v){
 const s=clean(v).toLowerCase();
 if(["selesai","delivered","diterima","completed"].includes(s))return"delivered";
 if(["dibatalkan","cancelled","rejected","returned","return","dikembalikan","disposed","failed"].includes(s))return"cancelled";
 if(["dijemput","dikirim","picked","in_transit","dropping_off","shipped","transit"].includes(s))return"shipped";
 return"processing";
}
function shipmentStatus(v){
 return v==="delivered"?"delivered":v==="cancelled"?"cancelled":v==="shipped"?"in_transit":"created";
}
function statusRank(v){
 const s=clean(v).toLowerCase();
 return s==="processing"||s==="created"?1:s==="shipped"||s==="in_transit"?2:s==="delivered"?3:s==="cancelled"?4:0;
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
  const orderNo=clean(body.order_no||body.order_id),awb=clean(body.cnote||body.awb||body.airway_bill||body.courier_waybill_id),incomingStatus=clean(body.status||body.order_status||body.event);
  if(!orderNo&&!awb)return json({ok:true,ignored:true});
  let rows=[];
  if(orderNo)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id,status&provider_order_id=eq.${encodeURIComponent(orderNo)}&limit=1`);
  if(!rows.length&&awb)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id,status&waybill_id=eq.${encodeURIComponent(awb)}&limit=1`);
  if(!rows.length)return json({ok:true,ignored:true});
  const shipment=rows[0],marketStatus=mapStatus(incomingStatus),nextShipmentStatus=shipmentStatus(marketStatus);
  const currentMarket=mapStatus(shipment.status);
  const currentRank=statusRank(currentMarket),incomingRank=statusRank(marketStatus);
  const isTerminal=currentMarket==="delivered"||currentMarket==="cancelled";
  const staleStatus=isTerminal || incomingRank<currentRank;
  const eventKey=clean(body.event_id||body.id||body.event||body.order_event_id||(orderNo+"|"+awb+"|"+incomingStatus+"|"+clean(body.updated_at||body.timestamp||"")));
  if(eventKey){
   const existing=await sb(u,k,"/rest/v1/webhook_events?select=id&provider=eq.rajaongkir_delivery&event_key=eq."+encodeURIComponent(eventKey)+"&limit=1");
   if(existing?.length)return json({ok:true,duplicate:true,event_key:eventKey});
   try{await sb(u,k,"/rest/v1/webhook_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({provider:"rajaongkir_delivery",event_key:eventKey,order_id:shipment.order_id,received_at:new Date().toISOString(),payload:body})});}
   catch(e){if(String(e?.message||"").includes("duplicate")||String(e?.message||"").includes("409"))return json({ok:true,duplicate:true,event_key:eventKey});throw e;}
  }
  if(staleStatus){
    return json({ok:true,ignored:true,stale:true,event_key:eventKey,current_status:currentMarket,incoming_status:marketStatus});
  }
  const patch={status:nextShipmentStatus,last_webhook_at:new Date().toISOString(),raw_response:body};
  if(nextShipmentStatus==="delivered"){
    patch.delivered_at=new Date().toISOString();
    patch.delivery_proof_at=new Date().toISOString();
    const proof=clean(body.delivery_proof_url||body.proof_url||body.photo_url||body.pod_url||body.pod);
    const recipient=clean(body.delivery_recipient||body.recipient||body.received_by);
    if(proof)patch.delivery_proof_url=proof;
    if(recipient)patch.delivery_recipient=recipient;
  }
  if(awb)patch.waybill_id=awb;
  await sb(u,k,`/rest/v1/shipping_shipments?id=eq.${encodeURIComponent(shipment.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
  await sb(u,k,`/rest/v1/order_sellers?id=eq.${encodeURIComponent(shipment.order_seller_id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({shipping_status:marketStatus,...(awb?{tracking_number:awb}:{}),seller_status:marketStatus==="delivered"?"completed":marketStatus})});
  const sellers=await sb(u,k,`/rest/v1/order_sellers?select=id,seller_status,shipping_status&order_id=eq.${encodeURIComponent(shipment.order_id)}`);
  const sellerRows=Array.isArray(sellers)?sellers:[];
  const allShipped=sellerRows.length>0&&sellerRows.every(x=>["shipped","delivered","completed"].includes(clean(x.shipping_status)));
  const allDelivered=sellerRows.length>0&&sellerRows.every(x=>["delivered","completed"].includes(clean(x.shipping_status)));
  const orderPatch={shipping_status:allDelivered?"delivered":allShipped?"shipped":"processing",updated_at:new Date().toISOString()};
  if(allDelivered){orderPatch.status="delivered";orderPatch.delivered_at=new Date().toISOString();}
  else if(allShipped){orderPatch.status="shipped";orderPatch.shipped_at=new Date().toISOString();}
  await sb(u,k,`/rest/v1/orders?id=eq.${encodeURIComponent(shipment.order_id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(orderPatch)});
  const orderRows=await sb(u,k,`/rest/v1/orders?select=buyer_id,order_number&id=eq.${encodeURIComponent(shipment.order_id)}&limit=1`);
  const buyerId=clean(orderRows?.[0]?.buyer_id);
  if(buyerId)await sb(u,k,"/rest/v1/notifications",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:buyerId,type:"shipping_update",title:marketStatus==="delivered"?"Pesanan diterima":marketStatus==="shipped"?"Pesanan dikirim":"Status pengiriman diperbarui",message:(orderRows?.[0]?.order_number||"Pesanan")+": status pengiriman "+(incomingStatus||marketStatus)+(awb?". Resi "+awb+".":""),link:"/?order="+encodeURIComponent(shipment.order_id),created_at:new Date().toISOString()})});
  return json({ok:true,order_no:orderNo,waybill_id:awb,market_status:marketStatus,shipment_status:nextShipmentStatus,event_key:eventKey});
 }catch(e){console.error("MarketKita RajaOngkir webhook:",e?.message||e);return json({error:e?.message||"Webhook gagal diproses."},500);}
}