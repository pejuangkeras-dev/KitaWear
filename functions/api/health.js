function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
async function supabaseProbe(env){
  const base=clean(env.SUPABASE_URL).replace(/\/+$/,""),key=clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if(!base||!key)return {ok:false,reason:"supabase_not_configured"};
  try{
    const r=await fetch(base+"/rest/v1/orders?select=id&limit=1",{headers:{apikey:key,Authorization:"Bearer "+key}});
    return {ok:r.ok,status:r.status};
  }catch{return {ok:false,reason:"supabase_unreachable"};}
}
export async function onRequestGet(context){
  const e=context.env||{},db=await supabaseProbe(e);
  const midtransConfigured=Boolean(clean(e.MIDTRANS_CLIENT_KEY)&&clean(e.MIDTRANS_SERVER_KEY));
  const midtransProduction=clean(e.MIDTRANS_IS_PRODUCTION).toLowerCase()==="true";
  const shippingConfigured=Boolean(clean(e.RAJAONGKIR_DELIVERY_API_KEY));
  const shippingBase=clean(e.RAJAONGKIR_DELIVERY_BASE_URL);
  const shippingProduction=shippingConfigured&&shippingBase&&!/sandbox|collaborator\.komerce\.id/i.test(shippingBase);
  return json({
    ok:Boolean(db.ok),
    service:"MarketKita health",
    status:db.ok?"healthy":"degraded",
    checks:{database:Boolean(db.ok),midtrans_configured:midtransConfigured,midtrans_mode:midtransProduction?"production":"sandbox",shipping_configured:shippingConfigured,shipping_mode:shippingProduction?"production":"sandbox"},
    timestamp:new Date().toISOString()
  },db.ok?200:503);
}
