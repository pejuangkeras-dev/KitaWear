function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function sh(k){return {apikey:k,Authorization:`Bearer ${k}`,"Content-Type":"application/json"};}
async function sb(u,k,p,o={}){const r=await fetch(u+p,{...o,headers:{...sh(k),...(o.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
async function bite(env,p,b){const k=String(env.BITESHIP_API_KEY||"").trim();if(!k)throw new Error("BITESHIP_API_KEY belum dipasang.");const r=await fetch("https://api.biteship.com"+p,{method:"POST",headers:{authorization:k,"content-type":"application/json"},body:JSON.stringify(b)});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok||d?.success===false)throw new Error(d?.message||d?.error||"Biteship gagal membuat shipment.");return d;}
export async function onRequestPost(context){
 try{
  const env=context.env,u=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""),k=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim(),secret=String(env.SHIPPING_INTERNAL_SECRET||"").trim();
  if(!u||!k||!secret)return json({error:"Konfigurasi shipping server belum lengkap."},500);
  if((context.request.headers.get("X-Shipping-Internal-Secret")||"")!==secret)return json({error:"Unauthorized"},401);
  const {order_id}=await context.request.json().catch(()=>({})); if(!order_id)return json({error:"order_id wajib."},400);
  const orders=await sb(u,k,`/rest/v1/orders?select=id,order_number,buyer_id,customer_name,customer_email,customer_phone,shipping_address,shipping_postal_code,shipping_quote_id,shipping_selections,status,payment_status&id=eq.${encodeURIComponent(order_id)}&limit=1`);
  const order=orders?.[0];if(!order)return json({error:"Order tidak ditemukan."},404);
  if(order.payment_status!=="paid")return json({error:"Shipment hanya dibuat setelah pembayaran paid."},409);
  const os=await sb(u,k,`/rest/v1/order_sellers?select=id,order_id,store_id,seller_id,shipping_fee,subtotal&order_id=eq.${encodeURIComponent(order.id)}`);
  const selected=Array.isArray(order.shipping_selections)?order.shipping_selections:[];
  const items=await sb(u,k,`/rest/v1/order_items?select=product_id,store_id,product_name,size,quantity,unit_price,line_total&order_id=eq.${encodeURIComponent(order.id)}`);
  const results=[];
  for(const seller of (os||[])){
   const existing=await sb(u,k,`/rest/v1/shipping_shipments?select=id,provider_order_id,waybill_id&order_seller_id=eq.${encodeURIComponent(seller.id)}&limit=1`);
   if(existing?.length){results.push(existing[0]);continue;}
   const choice=selected.find(x=>String(x.store_id)===String(seller.store_id));
   if(!choice)throw new Error("Pilihan kurir seller tidak ditemukan.");
   const stores=await sb(u,k,`/rest/v1/stores?select=id,name,pickup_name,pickup_phone,pickup_address,pickup_postal_code,pickup_note,pickup_latitude,pickup_longitude&id=eq.${encodeURIComponent(seller.store_id)}&limit=1`);
   const store=stores?.[0];if(!store)throw new Error("Toko pickup tidak ditemukan.");
   const productIds=(items||[]).filter(x=>String(x.store_id)===String(seller.store_id));
   const ids=[...new Set(productIds.map(x=>x.product_id).filter(Boolean))];
   const products=ids.length?await sb(u,k,`/rest/v1/products?select=id,name,weight_gram,length_cm,width_cm,height_cm&id=in.(${ids.map(encodeURIComponent).join(",")})`):[];
   const pm=new Map((products||[]).map(x=>[String(x.id),x]));
   const shipItems=productIds.map(x=>{const p=pm.get(String(x.product_id))||{};return{name:x.product_name,description:`Size ${x.size}`,category:"fashion",value:Number(x.unit_price||0),quantity:Number(x.quantity||1),weight:Number(p.weight_gram||500),length:Number(p.length_cm||20),width:Number(p.width_cm||15),height:Number(p.height_cm||5)};});
   const payload={origin_contact_name:store.pickup_name,origin_contact_phone:store.pickup_phone,origin_address:store.pickup_address,origin_postal_code:Number(store.pickup_postal_code),origin_note:store.pickup_note||"",destination_contact_name:order.customer_name,destination_contact_phone:order.customer_phone,destination_contact_email:order.customer_email,destination_address:order.shipping_address,destination_postal_code:Number(order.shipping_postal_code),courier_company:choice.courier_company,courier_type:choice.courier_type,delivery_type:"now",reference_id:`${order.id}-${seller.id}`,metadata:{marketkita_order_id:order.id,order_seller_id:seller.id},items:shipItems};
   if(store.pickup_latitude!=null&&store.pickup_longitude!=null)payload.origin_coordinate={latitude:Number(store.pickup_latitude),longitude:Number(store.pickup_longitude)};
   const created=await bite(env,"/v1/orders",payload), courier=created?.courier||{};
   const row={order_seller_id:seller.id,order_id:order.id,provider:"biteship",provider_order_id:created.id||null,provider_tracking_id:courier.tracking_id||null,courier_company:courier.company||choice.courier_company,courier_type:courier.type||choice.courier_type,waybill_id:courier.waybill_id||null,status:created.status||"confirmed",shipping_fee:Number(created.price||choice.price||seller.shipping_fee||0),tracking_url:courier.link||null,pickup_requested_at:new Date().toISOString(),raw_response:created};
   const inserted=await sb(u,k,"/rest/v1/shipping_shipments",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
   await sb(u,k,`/rest/v1/order_sellers?id=eq.${encodeURIComponent(seller.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({tracking_number:courier.waybill_id||null,shipping_status:"processing",seller_status:"processing"})});
   results.push(inserted?.[0]||row);
  }
  return json({ok:true,order_id:order.id,shipments:results});
 }catch(e){console.error("MarketKita shipping create:",e?.message||e);return json({error:e?.message||"Gagal membuat shipment."},500);}
}