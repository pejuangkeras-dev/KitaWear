function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
function normalizeUrl(v){return String(v||"").trim().replace(/\/+$/,"");}
async function supabaseRequest(url,key,path,options={}){
  const r=await fetch(`${url}${path}`,{
    ...options,
    headers:{
      apikey:key,
      Authorization:`Bearer ${key}`,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });
  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{data={raw:text};}
  if(!r.ok){
    const e=new Error(String(data?.message||data?.error_description||data?.hint||data?.details||data?.error||`Supabase HTTP ${r.status}`));
    e.status=r.status;e.data=data;throw e;
  }
  return data;
}
async function getAuthenticatedUser(request,supabaseUrl,anonKey){
  const h=request.headers.get("Authorization")||"";
  if(!h.toLowerCase().startsWith("bearer "))return null;
  const token=h.slice(7).trim();
  if(!token||!anonKey)return null;
  const r=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});
  if(!r.ok)return null;
  const u=await r.json().catch(()=>null);
  return u?.id?u:null;
}
export async function onRequestPost(context){
  try{
    const env=context.env;
    const supabaseUrl=normalizeUrl(env.SUPABASE_URL);
    const serviceKey=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
    const anonKey=String(env.SUPABASE_ANON_KEY||"").trim();
    const serverKey=String(env.MIDTRANS_SERVER_KEY||"").trim();
    const production=String(env.MIDTRANS_IS_PRODUCTION||"false").toLowerCase()==="true";
    if(!supabaseUrl||!serviceKey||!anonKey||!serverKey)return json({error:"Konfigurasi refund belum lengkap."},500);

    const user=await getAuthenticatedUser(context.request,supabaseUrl,anonKey);
    if(!user)return json({error:"Login admin diperlukan."},401);

    const profiles=await supabaseRequest(supabaseUrl,serviceKey,`/rest/v1/profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if(!profiles?.length||profiles[0].role!=="admin")return json({error:"Akses ditolak. Hanya admin."},403);

    const body=await context.request.json();
    const disputeId=String(body?.dispute_id||"").trim();
    const reason=String(body?.reason||"Sengketa MarketKita").trim().slice(0,255);
    if(!disputeId)return json({error:"dispute_id wajib diisi."},400);

    const disputes=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/disputes?select=id,order_id,buyer_id,status,reason,description& id=eq.${encodeURIComponent(disputeId)}&limit=1`.replace("%20","")
    );
    if(!disputes?.length)return json({error:"Sengketa tidak ditemukan."},404);
    const dispute=disputes[0];
    if(!["open","reviewing"].includes(String(dispute.status)))return json({error:"Sengketa sudah diproses."},409);

    const orders=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/orders?select=id,order_number,midtrans_order_id,midtrans_transaction_id,total,payment_status,status&id=eq.${encodeURIComponent(dispute.order_id)}&limit=1`
    );
    if(!orders?.length)return json({error:"Order sengketa tidak ditemukan."},404);
    const order=orders[0];

    if(order.payment_status!=="paid")return json({error:"Order belum berstatus paid sehingga tidak dapat direfund melalui Midtrans."},400);
    const midtransId=String(order.midtrans_order_id||order.midtrans_transaction_id||"").trim();
    if(!midtransId)return json({error:"Order belum memiliki ID transaksi Midtrans."},400);

    const endpoint=production
      ? `https://api.midtrans.com/v2/${encodeURIComponent(midtransId)}/refund`
      : `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(midtransId)}/refund`;

    const refundKey=`MK-REFUND-${disputeId}`;
    const refundResponse=await fetch(endpoint,{
      method:"POST",
      headers:{
        Accept:"application/json",
        "Content-Type":"application/json",
        Authorization:`Basic ${btoa(serverKey+":")}`
      },
      body:JSON.stringify({
        refund_key:refundKey,
        amount:Number(order.total),
        reason
      })
    });
    const refundText=await refundResponse.text();
    let refundData=null;
    try{refundData=refundText?JSON.parse(refundText):null}catch{refundData={raw:refundText};}

    if(!refundResponse.ok){
      return json({
        error:refundData?.status_message||refundData?.message||"Midtrans menolak request refund.",
        midtrans:refundData
      },502);
    }

    const refundStatus=String(refundData?.transaction_status||"").toLowerCase();
    if(!["refund","partial_refund"].includes(refundStatus)){
      return json({error:"Midtrans belum mengonfirmasi status refund.",midtrans:refundData},502);
    }

    const rpc=await supabaseRequest(
      supabaseUrl,serviceKey,
      "/rest/v1/rpc/admin_resolve_dispute_service",
      {method:"POST",body:JSON.stringify({
        p_dispute_id:disputeId,
        p_resolution:refundStatus==="refund"?"resolved_buyer":"reviewing"
      })}
    );

    return json({
      ok:true,
      dispute_id:disputeId,
      order_id:order.id,
      midtrans_status:refundStatus,
      refund_amount:refundData?.refund_amount||order.total,
      resolution:rpc
    });
  }catch(error){
    console.error("MarketKita refund error:",error?.message||error);
    return json({error:error?.message||"Refund gagal diproses."},500);
  }
}
export async function onRequestGet(){return json({ok:true,service:"MarketKita Refund"});}
