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
  if(!token)return null;
  const r=await fetch(`${supabaseUrl}/auth/v1/user`,{
    headers:{apikey:anonKey,Authorization:`Bearer ${token}`}
  });
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

    if(!supabaseUrl||!serviceKey||!anonKey||!serverKey){
      return json({error:"Konfigurasi refund belum lengkap."},500);
    }

    const user=await getAuthenticatedUser(context.request,supabaseUrl,anonKey);
    if(!user)return json({error:"Login admin diperlukan."},401);

    const profiles=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}&limit=1`
    );
    if(!profiles?.length||profiles[0].role!=="admin"){
      return json({error:"Akses ditolak. Hanya admin."},403);
    }

    const body=await context.request.json().catch(()=>({}));
    const disputeId=String(body?.dispute_id||"").trim();
    if(!disputeId)return json({error:"dispute_id wajib diisi."},400);

    const refunds=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/refund_requests?select=id,dispute_id,order_id,refund_key,amount,status,midtrans_status_code,midtrans_status_message,midtrans_refund_chargeback_id,refund_amount,midtrans_transaction_id,bank_confirmed_at,error_message&dispute_id=eq.${encodeURIComponent(disputeId)}&limit=1`
    );
    if(!refunds?.length)return json({error:"Refund request belum dibuat untuk sengketa ini."},404);

    const refund=refunds[0];
    if(String(refund.status)==="succeeded"){
      return json({ok:true,status:"succeeded",refund,checked_midtrans:false});
    }

    const orders=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/orders?select=id,midtrans_order_id,midtrans_transaction_id&id=eq.${encodeURIComponent(String(refund.order_id))}&limit=1`
    );
    if(!orders?.length)return json({error:"Order refund tidak ditemukan."},404);

    const order=orders[0];
    const midtransId=String(order.midtrans_order_id||order.midtrans_transaction_id||"").trim();
    if(!midtransId)return json({error:"Order belum memiliki ID transaksi Midtrans."},400);

    const endpoint=production
      ? `https://api.midtrans.com/v2/${encodeURIComponent(midtransId)}/status`
      : `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(midtransId)}/status`;

    const statusResponse=await fetch(endpoint,{
      method:"GET",
      headers:{
        Accept:"application/json",
        Authorization:`Basic ${btoa(serverKey+":")}`
      }
    });

    const statusText=await statusResponse.text();
    let statusData=null;
    try{statusData=statusText?JSON.parse(statusText):null}catch{statusData=null;}

    if(!statusResponse.ok){
      return json({
        ok:false,
        status:refund.status,
        checked_midtrans:true,
        midtrans_http_status:statusResponse.status,
        midtrans:statusData
      },502);
    }

    const refundRows=Array.isArray(statusData?.refunds)?statusData.refunds:[];
    const matchingRefund=refundRows.find(item =>
      String(item?.refund_key||"").trim()===String(refund.refund_key||"").trim()
    ) || null;

    const confirmedAtRaw=matchingRefund?.bank_confirmed_at||null;
    const transactionStatus=String(statusData?.transaction_status||"").toLowerCase();

    if(transactionStatus==="refund" && confirmedAtRaw){
      const confirmedAt=new Date(confirmedAtRaw).toISOString();
      const confirmedAmount=Number(
        matchingRefund?.refund_amount ??
        statusData?.refund_amount ??
        refund.amount ??
        0
      );

      const syncResult=await supabaseRequest(
        supabaseUrl,serviceKey,
        "/rest/v1/rpc/service_update_refund_request",
        {
          method:"POST",
          body:JSON.stringify({
            p_refund_key:refund.refund_key,
            p_status:"succeeded",
            p_status_code:String(statusData?.status_code||"200"),
            p_status_message:String(statusData?.status_message||"Refund confirmed by Midtrans."),
            p_refund_chargeback_id:matchingRefund?.refund_chargeback_id!=null
              ? String(matchingRefund.refund_chargeback_id):null,
            p_refund_amount:Number.isFinite(confirmedAmount)?confirmedAmount:null,
            p_midtrans_transaction_id:String(
              statusData?.transaction_id||order.midtrans_transaction_id||""
            )||null,
            p_bank_confirmed_at:confirmedAt,
            p_raw_response:statusData,
            p_error_message:null
          })
        }
      );

      return json({
        ok:true,
        status:"succeeded",
        synchronized:true,
        refund:syncResult,
        midtrans:statusData
      });
    }

    return json({
      ok:true,
      status:refund.status,
      synchronized:false,
      checked_midtrans:true,
      transaction_status:transactionStatus||null,
      refund_found:Boolean(matchingRefund),
      bank_confirmed_at:confirmedAtRaw,
      midtrans_refund:matchingRefund,
      midtrans:statusData
    });
  }catch(error){
    console.error("admin-refund-status error:",error);
    return json({error:error?.message||"Gagal mengecek status refund."},500);
  }
}
