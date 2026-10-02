function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
function sh(k){return{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...sh(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
function marketStatus(s){
  const v=clean(s).toLowerCase();
  if(/selesai|delivered|complete|terkirim/.test(v))return"delivered";
  if(/dibatalkan|cancel|return|gagal/.test(v))return"cancelled";
  if(/dikirim|transit|pickup|dijemput|manifest|shipped/.test(v))return"shipped";
  return"processing";
}
async function handle(context){
  const e=context.env,u=clean(e.SUPABASE_URL).replace(/\/+$/,""),k=clean(e.SUPABASE_SERVICE_ROLE_KEY),secret=clean(e.RAJAONGKIR_WEBHOOK_SECRET||e.BITESHIP_WEBHOOK_SECRET),header=clean(e.RAJAONGKIR_WEBHOOK_HEADER)||"X-MarketKita-Shipping-Secret";
  if(!u||!k)return json({error:"Konfigurasi Supabase server belum lengkap."},500);
  if(!secret)return json({error:"Konfigurasi webhook shipping belum lengkap."},500);
  if(context.request.headers.get(header)!==secret)return json({error:"Unauthorized"},401);
  const body=await context.request.json().catch(()=>({}));
  const orderNo=clean(body.order_no),awb=clean(body.cnote),status=clean(body.status);
  if(!orderNo&&!awb)return json({ok:true,ignored:true,reason:"Payload tidak memiliki order_no maupun cnote."});
  let rows=[];
  if(orderNo)rows=await sb(u,k,"/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id,waybill_id&provider=eq.rajaongkir_delivery&provider_order_id=eq."+encodeURIComponent(orderNo)+"&limit=10");
  if(!rows.length&&awb)rows=await sb(u,k,"/rest/v1/shipping_shipments?select=id,order_id,order_seller_id,provider_order_id,waybill_id&provider=eq.rajaongkir_delivery&waybill_id=eq."+encodeURIComponent(awb)+"&limit=10");
  if(!rows.length)return json({ok:true,ignored:true,reason:"Shipment belum terdaftar di MarketKita."});
  const ms=marketStatus(status);
  const now=new Date().toISOString();
  for(const row of rows){
    await sb(u,k,"/rest/v1/shipping_shipments?id=eq."+encodeURIComponent(row.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({waybill_id:awb||row.waybill_id,status:status||ms,last_webhook_at:now,updated_at:now})});
    const sellerStatus=ms==="delivered"?"completed":ms==="shipped"?"shipped":ms==="cancelled"?"cancelled":"processing";
    await sb(u,k,"/rest/v1/order_sellers?id=eq."+encodeURIComponent(row.order_seller_id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({tracking_number:awb||row.waybill_id||null,shipping_status:ms,seller_status:sellerStatus,updated_at:now})});
    const all=await sb(u,k,"/rest/v1/order_sellers?select=id,shipping_status&order_id=eq."+encodeURIComponent(row.order_id));
    const list=Array.isArray(all)?all:[],allDelivered=list.length>0&&list.every(x=>String(x.shipping_status||"")==="delivered"),allShipped=list.length>0&&list.every(x=>["shipped","delivered"].includes(String(x.shipping_status||"")));
    const orders=await sb(u,k,"/rest/v1/orders?select=id,status,shipping_status,shipped_at,delivered_at&id=eq."+encodeURIComponent(row.order_id)+"&limit=1"),order=orders?.[0];
    if(order){
      const patch={shipping_status:allDelivered?"delivered":allShipped?"shipped":ms,updated_at:now};
      if(allDelivered&&["paid","processing","shipped","delivered"].includes(String(order.status||""))){patch.status="delivered";patch.delivered_at=order.delivered_at||now;}
      else if(allShipped&&["paid","processing"].includes(String(order.status||""))){patch.status="shipped";patch.shipped_at=order.shipped_at||now;}
      await sb(u,k,"/rest/v1/orders?id=eq."+encodeURIComponent(row.order_id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)});
    }
  }
  return json({ok:true,updated:rows.length,status:ms});
}
export async function onRequestPost(context){return handle(context);}
export async function onRequestPut(context){return handle(context);}
export async function onRequestGet(){return json({ok:true,service:"MarketKita RajaOngkir Delivery Webhook"});}