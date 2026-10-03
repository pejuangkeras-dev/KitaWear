function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v??"").trim();
async function sb(env,path){
 const base=clean(env.SUPABASE_URL).replace(/\/+$/,""),key=clean(env.SUPABASE_SERVICE_ROLE_KEY);
 if(!base||!key)throw Error("SUPABASE_SERVER_CONFIG_MISSING");
 const r=await fetch(base+path,{headers:{apikey:key,Authorization:"Bearer "+key}});
 const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=null}
 if(!r.ok)throw Error(d?.message||d?.details||d?.hint||"Supabase probe failed");
 return d;
}
async function auth(context){
 const base=clean(context.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(context.env.SUPABASE_ANON_KEY),h=context.request.headers.get("Authorization")||"";
 if(!base||!key||!/^Bearer\s+/i.test(h))return null;
 const r=await fetch(base+"/auth/v1/user",{headers:{apikey:key,Authorization:h}});
 return r.ok?r.json().catch(()=>null):null;
}
export async function onRequestGet(context){
 const u=await auth(context);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
 try{
  const profile=await sb(context.env,"/rest/v1/profiles?select=role&id=eq."+encodeURIComponent(u.id)+"&limit=1");
  if(String(profile?.[0]?.role||"").toLowerCase()!=="admin")return json({error:"ADMIN_REQUIRED"},403);
  const [orders,returns,disputes,refunds,payouts,shipments,events]=await Promise.all([
   sb(context.env,"/rest/v1/orders?select=id,status,payment_status,shipping_status,created_at,updated_at&order=created_at.desc&limit=500"),
   sb(context.env,"/rest/v1/return_requests?select=id,status,created_at&order=created_at.desc&limit=500"),
   sb(context.env,"/rest/v1/disputes?select=id,status,created_at&order=created_at.desc&limit=500"),
   sb(context.env,"/rest/v1/refund_requests?select=id,status,amount,created_at&order=created_at.desc&limit=500"),
   sb(context.env,"/rest/v1/seller_payout_requests?select=id,status,amount,requested_at&order=requested_at.desc&limit=500"),
   sb(context.env,"/rest/v1/shipping_shipments?select=id,status,tracking_number,updated_at&order=updated_at.desc&limit=500"),
   sb(context.env,"/rest/v1/shipping_tracking_events?select=id,status,event_at,created_at&order=event_at.desc&limit=500")
  ]);
  const count=(arr,p)=>arr.filter(p).length,sum=(arr,p)=>arr.filter(p).reduce((n,x)=>n+Number(x.amount||0),0);
  const openReturns=count(returns,x=>!["resolved","rejected","cancelled","completed"].includes(String(x.status||"").toLowerCase()));
  const openDisputes=count(disputes,x=>!["resolved","closed","cancelled"].includes(String(x.status||"").toLowerCase()));
  const pendingRefunds=count(refunds,x=>!["completed","paid","failed","cancelled"].includes(String(x.status||"").toLowerCase()));
  const pendingPayouts=count(payouts,x=>["pending","requested","processing"].includes(String(x.status||"").toLowerCase()));
  const shipmentExceptions=count(shipments,x=>["exception","failed","returned"].includes(String(x.status||"").toLowerCase()));
  const unpaid=count(orders,x=>["pending_payment","pending"].includes(String(x.payment_status||x.status||"").toLowerCase()));
  const last24=Date.now()-86400000;
  const recentEvents=events.filter(x=>new Date(x.event_at||x.created_at).getTime()>=last24).length;
  const orderStatus={};
  for(const o of orders){const s=String(o.status||"unknown");orderStatus[s]=(orderStatus[s]||0)+1;}
  return json({ok:true,timestamp:new Date().toISOString(),scope:"latest 500 records per operational queue",summary:{
    orders:orders.length,unpaid,open_returns:openReturns,open_disputes:openDisputes,pending_refunds:pendingRefunds,
    pending_payouts:pendingPayouts,pending_payout_amount:sum(payouts,x=>["pending","requested","processing"].includes(String(x.status||"").toLowerCase())),
    shipment_exceptions:shipmentExceptions,tracking_events_24h:recentEvents
  },order_status:orderStatus});
 }catch(e){console.error("G9 operations:",e?.message||e);return json({ok:false,error:e?.message||"Gagal memuat operations center."},500);}
}
