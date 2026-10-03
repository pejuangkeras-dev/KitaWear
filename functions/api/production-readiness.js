function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
const clean=v=>String(v==null?"":v).trim();
async function authUser(context){
  const base=clean(context.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(context.env.SUPABASE_ANON_KEY),h=context.request.headers.get("Authorization")||"";
  if(!base||!anon||!/^Bearer\s+/i.test(h))return null;
  const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
  if(!r.ok)return null;
  const u=await r.json().catch(()=>null);return u?.id?u:null;
}
async function isAdmin(context,userId){
  const base=clean(context.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(context.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!base||!key)return false;
  const r=await fetch(base+"/rest/v1/profiles?select=role&id=eq."+encodeURIComponent(userId)+"&limit=1",{headers:{apikey:key,Authorization:"Bearer "+key}});
  const rows=await r.json().catch(()=>[]);
  return String(rows?.[0]?.role||"").toLowerCase()==="admin";
}
async function probe(base,key,path){
  try{const r=await fetch(base+path,{headers:{apikey:key,Authorization:"Bearer "+key}});return r.ok;}catch{return false;}
}
export async function onRequestGet(context){
  const user=await authUser(context);
  if(!user)return json({error:"LOGIN_REQUIRED"},401);
  if(!(await isAdmin(context,user.id)))return json({error:"ADMIN_REQUIRED"},403);
  const e=context.env||{},base=clean(e.SUPABASE_URL).replace(/\/+$/,""),key=clean(e.SUPABASE_SERVICE_ROLE_KEY);
  if(!base||!key)return json({ok:false,error:"SUPABASE_NOT_CONFIGURED"},500);
  const database=await probe(base,key,"/rest/v1/orders?select=id&limit=1");
  const midtransConfigured=Boolean(clean(e.MIDTRANS_SERVER_KEY)&&clean(e.MIDTRANS_CLIENT_KEY));
  const midtransProduction=clean(e.MIDTRANS_IS_PRODUCTION).toLowerCase()==="true";
  const shippingConfigured=Boolean(clean(e.RAJAONGKIR_DELIVERY_API_KEY)&&clean(e.RAJAONGKIR_DELIVERY_BASE_URL));
  const shippingProduction=shippingConfigured&&!/sandbox|collaborator\.komerce\.id/i.test(clean(e.RAJAONGKIR_DELIVERY_BASE_URL));
  const checks={database,midtrans_configured:midtransConfigured,midtrans_production:midtransProduction,shipping_configured:shippingConfigured,shipping_production:shippingProduction};
  const ready=database&&midtransConfigured&&midtransProduction&&shippingConfigured&&shippingProduction;
  return json({ok:ready,service:"MarketKita production readiness",status:ready?"ready":"blocked",checks,timestamp:new Date().toISOString()},ready?200:503);
}
