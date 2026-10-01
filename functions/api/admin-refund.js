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
    const reason=String(body?.reason||"Refund sengketa MarketKita").trim().slice(0,255);
    if(!disputeId)return json({error:"dispute_id wajib diisi."},400);

    const authHeader=context.request.headers.get("Authorization")||"";
    const userToken=authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim() : "";
    if(!userToken)return json({error:"Session admin diperlukan."},401);

    // Create/reuse an auditable refund request through the admin-only RPC.
    const begin=await supabaseRequest(
      supabaseUrl,serviceKey,
      "/rest/v1/rpc/admin_begin_dispute_refund",
      {
        method:"POST",
        headers:{
          apikey:anonKey,
          Authorization:`Bearer ${userToken}`
        },
        body:JSON.stringify({
          p_dispute_id:disputeId,
          p_reason:reason
        })
      }
    );

    const request=Array.isArray(begin)?begin[0]:begin;
    const refundKey=String(request?.refund_key||"").trim();
    const amount=Number(request?.amount||0);
    if(!refundKey||!Number.isFinite(amount)||amount<=0){
      return json({error:"Refund request tidak valid."},500);
    }

    const orders=await supabaseRequest(
      supabaseUrl,serviceKey,
      `/rest/v1/orders?select=id,order_number,midtrans_order_id,midtrans_transaction_id,total,payment_status,status&id=eq.${encodeURIComponent(String(request.order_id))}&limit=1`
    );
    if(!orders?.length)return json({error:"Order sengketa tidak ditemukan."},404);
    const order=orders[0];

    // Idempotency must be checked before payment_status because the
    // first successful refund request may already have moved the order
    // to refunded while the provider confirmation is still pending.
    if(["requested","pending_confirmation","succeeded"].includes(String(request.status||""))){
      // Never create a second refund. If the webhook has not arrived yet,
      // ask Midtrans for the current transaction status and synchronize the
      // matching refund confirmation when bank_confirmed_at is available.
      if(String(request.status||"")!=="succeeded"){
        const midtransId=String(order.midtrans_order_id||order.midtrans_transaction_id||"").trim();
        if(midtransId){
          const statusEndpoint=production
            ? `https://api.midtrans.com/v2/${encodeURIComponent(midtransId)}/status`
            : `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(midtransId)}/status`;

          try{
            const statusResponse=await fetch(statusEndpoint,{
              method:"GET",
              headers:{
                Accept:"application/json",
                Authorization:`Basic ${btoa(serverKey+":")}`
              }
            });
            const statusText=await statusResponse.text();
            let statusData=null;
            try{statusData=statusText?JSON.parse(statusText):null}catch{statusData=null;}

            if(statusResponse.ok){
              const refundRows=Array.isArray(statusData?.refunds)?statusData.refunds:[];
              const matchingRefund=refundRows.find(item =>
                String(item?.refund_key||"").trim()===refundKey
              ) || null;

              const confirmedAtRaw=matchingRefund?.bank_confirmed_at||null;

              if(
                String(statusData?.transaction_status||"").toLowerCase()==="refund" &&
                confirmedAtRaw
              ){
                const confirmedAt=new Date(confirmedAtRaw).toISOString();
                const confirmedAmount=Number(
                  matchingRefund?.refund_amount ??
                  statusData?.refund_amount ??
                  request.amount ??
                  0
                );

                const syncResult=await supabaseRequest(
                  supabaseUrl,serviceKey,
                  "/rest/v1/rpc/service_update_refund_request",
                  {
                    method:"POST",
                    body:JSON.stringify({
                      p_refund_key:refundKey,
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
                  dispute_id:disputeId,
                  order_id:order.id,
                  refund_key:refundKey,
                  status:"succeeded",
                  already_requested:true,
                  synchronized_from_midtrans:true,
                  refund:syncResult
                });
              }
            }
          }catch(statusError){
            console.warn("Midtrans refund status sync skipped:",statusError?.message||statusError);
          }
        }
      }

      return json({
        ok:true,
        dispute_id:disputeId,
        order_id:order.id,
        refund_key:refundKey,
        status:request.status,
        already_requested:true
      });
    }

    if(order.payment_status!=="paid"){
      return json({error:"Order belum berstatus paid sehingga tidak dapat direfund melalui Midtrans."},400);
    }

    const midtransId=String(order.midtrans_order_id||order.midtrans_transaction_id||"").trim();
    if(!midtransId)return json({error:"Order belum memiliki ID transaksi Midtrans."},400);

    const endpoint=production
      ? `https://api.midtrans.com/v2/${encodeURIComponent(midtransId)}/refund`
      : `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(midtransId)}/refund`;

    const refundResponse=await fetch(endpoint,{
      method:"POST",
      headers:{
        Accept:"application/json",
        "Content-Type":"application/json",
        Authorization:`Basic ${btoa(serverKey+":")}`
      },
      body:JSON.stringify({
        refund_key:refundKey,
        amount,
        reason
      })
    });

    const refundText=await refundResponse.text();
    let refundData=null;
    try{refundData=refundText?JSON.parse(refundText):null}catch{refundData={raw:refundText};}

    if(!refundResponse.ok){
      await supabaseRequest(
        supabaseUrl,serviceKey,
        "/rest/v1/rpc/service_update_refund_request",
        {
          method:"POST",
          body:JSON.stringify({
            p_refund_key:refundKey,
            p_status:"failed",
            p_status_code:String(refundData?.status_code||refundResponse.status),
            p_status_message:String(refundData?.status_message||refundData?.message||"Midtrans menolak request refund."),
            p_raw_response:refundData||{},
            p_error_message:String(refundData?.status_message||refundData?.message||"Midtrans menolak request refund.")
          })
        }
      );
      return json({
        error:refundData?.status_message||refundData?.message||"Midtrans menolak request refund.",
        midtrans:refundData
      },502);
    }

    // A successful HTTP response means Midtrans accepted the refund request.
    // Do not mark the order refunded until the confirmed webhook arrives.
    const midtransStatus=String(refundData?.transaction_status||"").toLowerCase();
    const midtransCode=String(refundData?.status_code||"").trim();

    await supabaseRequest(
      supabaseUrl,serviceKey,
      "/rest/v1/rpc/service_update_refund_request",
      {
        method:"POST",
        body:JSON.stringify({
          p_refund_key:refundKey,
          p_status:"pending_confirmation",
          p_status_code:midtransCode||"200",
          p_status_message:String(refundData?.status_message||"Refund request diterima Midtrans."),
          p_refund_chargeback_id:refundData?.refund_chargeback_id!=null
            ? String(refundData.refund_chargeback_id):null,
          p_refund_amount:Number(refundData?.refund_amount||0)||null,
          p_midtrans_transaction_id:String(
            refundData?.transaction_id||order.midtrans_transaction_id||""
          )||null,
          p_raw_response:refundData||{},
          p_error_message:null
        })
      }
    );

    return json({
      ok:true,
      dispute_id:disputeId,
      order_id:order.id,
      refund_key:refundKey,
      status:"pending_confirmation",
      midtrans_status:midtransStatus||"refund_requested",
      refund_amount:Number(refundData?.refund_amount||amount),
      message:"Refund diterima Midtrans dan menunggu konfirmasi bank/payment provider."
    });
  }catch(error){
    console.error("MarketKita refund error:",error?.message||error);
    return json({error:error?.message||"Refund gagal diproses."},500);
  }
}

export async function onRequestGet(){
  return json({ok:true,service:"MarketKita Refund"});
}
