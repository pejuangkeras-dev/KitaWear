function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8"}});}
function h(k){return{apikey:k,Authorization:`Bearer ${k}`,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...h(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
function map(s){s=String(s||"").toLowerCase();if(["confirmed","scheduled","allocated","picking_up"].includes(s))return"processing";if(["picked","in_transit","dropping_off"].includes(s))return"shipped";if(s==="delivered")return"delivered";if(["cancelled","rejected","returned","disposed"].includes(s))return"cancelled";if(s==="on_hold"||s==="courier_not_found")return"processing";return"processing";}
export async function onRequestPost(context){
 try{
  const env=context.env,u=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""),k=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
  const headerName=String(env.BITESHIP_WEBHOOK_HEADER||"X-MarketKita-Shipping-Secret").trim(),secret=String(env.BITESHIP_WEBHOOK_SECRET||"").trim();
  if(!u||!k||!secret)return json({error:"Konfigurasi webhook shipping belum lengkap."},500);
  if(context.request.headers.get(headerName)!==secret)return json({error:"Unauthorized"},401);
  const body=await context.request.json().catch(()=>({})),event=String(body.event||"");
  const providerOrderId=String(body.order_id||"").trim(),waybill=String(body.courier_waybill_id||"").trim(),trackingId=String(body.courier_tracking_id||"").trim();
  if(!providerOrderId&&!waybill&&!trackingId)return json({ok:true,ignored:true});
  let rows=[];
  if(providerOrderId)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id&provider_order_id=eq.${encodeURIComponent(providerOrderId)}&limit=1`);
  if(!rows.length&&waybill)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id&waybill_id=eq.${encodeURIComponent(waybill)}&limit=1`);
  if(!rows.length&&trackingId)rows=await sb(u,k,`/rest/v1/shipping_shipments?select=id,order_id,order_seller_id&provider_tracking_id=eq.${encodeURIComponent(trackingId)}&limit=1`);
  if(!rows.length)return json({ok:true,ignored:true});
  const shipment=rows[0],status=String(body.status||"").toLowerCase(),marketStatus=map(status);
  const patch={status,provider_tracking_id:trackingId||null,waybill_id:waybill||null,last_webhook_at:new Date().toISOString(),raw_response:body};
  if(body.courier_company)patch.courier_company=body.courier_company;
  if(body.courier_type)patch.courier_type=body.courier_type;
  if(body.courier_link)patch.tracking_url=body.courier_link;
  await sb(u,k,`/rest/v1/shipping_shipments?id=eq.${encodeURIComponent(shipment.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
  const sellerPatch={
    shipping_status:marketStatus,
    tracking_number:waybill||null
  };
  if(["processing","shipped","delivered","cancelled"].includes(marketStatus)){
    sellerPatch.seller_status=marketStatus==="delivered"?"completed":marketStatus;
  }
  await sb(u,k,`/rest/v1/order_sellers?id=eq.${encodeURIComponent(shipment.order_seller_id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(sellerPatch)});

  const sellers=await sb(
    u,k,
    `/rest/v1/order_sellers?select=id,seller_status,shipping_status&order_id=eq.${encodeURIComponent(shipment.order_id)}`
  );
  const sellerRows=Array.isArray(sellers)?sellers:[];
  const allShipped=sellerRows.length>0 && sellerRows.every(x=>["shipped","delivered","completed"].includes(String(x.shipping_status||"")));
  const allDelivered=sellerRows.length>0 && sellerRows.every(x=>["delivered"].includes(String(x.shipping_status||"")));

  if(marketStatus==="shipped" && allShipped){
    await sb(u,k,`/rest/v1/orders?id=eq.${encodeURIComponent(shipment.order_id)}&status=eq.paid`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:"shipped",shipping_status:"shipped",shipped_at:new Date().toISOString()})
    });
  }

  if(marketStatus==="delivered" && allDelivered){
    await sb(u,k,`/rest/v1/orders?id=eq.${encodeURIComponent(shipment.order_id)}&status=eq.shipped`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:"delivered",shipping_status:"delivered",delivered_at:new Date().toISOString()})
    });
  }
  return json({ok:true,event,market_status:marketStatus});
 }catch(e){console.error("MarketKita Biteship webhook:",e?.message||e);return json({error:e?.message||"Webhook gagal diproses."},500);}
}
export async function onRequestGet(){return json({ok:true,service:"MarketKita Biteship Webhook"});}