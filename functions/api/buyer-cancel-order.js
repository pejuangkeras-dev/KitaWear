function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
function normalizeUrl(v){return String(v||"").trim().replace(/\/+$/,"");}
async function sb(url,key,path,options={}){
  const r=await fetch(url+path,{...options,headers:{
    apikey:key,
    Authorization:`Bearer ${key}`,
    "Content-Type":"application/json",
    ...(options.headers||{})
  }});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t};}
  if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);
  return d;
}
async function getUser(context,url,anon){
  const h=context.request.headers.get("Authorization")||"";
  if(!h.toLowerCase().startsWith("bearer ")||!anon)return null;
  const token=h.slice(7).trim();if(!token)return null;
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
  if(!r.ok)return null;
  const u=await r.json().catch(()=>null);
  return u?.id?u:null;
}
export async function onRequestPost(context){
  try{
    const env=context.env;
    const url=normalizeUrl(env.SUPABASE_URL);
    const serviceKey=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
    const anonKey=String(env.SUPABASE_ANON_KEY||"").trim();
    const serverKey=String(env.MIDTRANS_SERVER_KEY||"").trim();
    const production=String(env.MIDTRANS_IS_PRODUCTION||"false").toLowerCase()==="true";
    if(!url||!serviceKey||!anonKey||!serverKey)return json({error:"Konfigurasi pembatalan belum lengkap."},500);

    const auth=context.request.headers.get("Authorization")||"";
    const user=await getUser(context,url,anonKey);
    if(!user)return json({error:"Login diperlukan."},401);

    const body=await context.request.json().catch(()=>({}));
    const orderId=String(body?.order_id||"").trim();
    if(!orderId)return json({error:"order_id wajib diisi."},400);

    const orders=await sb(
      url,serviceKey,
      `/rest/v1/orders?select=id,order_number,buyer_id,status,payment_status&buyer_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(orderId)}&limit=1`
    );
    const order=orders?.[0];
    if(!order)return json({error:"Pesanan tidak ditemukan."},404);
    if(order.status!=="pending_payment"||order.payment_status!=="pending"){
      return json({error:"Pesanan hanya dapat dibatalkan sebelum pembayaran berhasil."},409);
    }

    const base=production?"https://api.midtrans.com":"https://api.sandbox.midtrans.com";
    const authBasic=btoa(serverKey+":");
    const statusResponse=await fetch(
      `${base}/v2/${encodeURIComponent(order.order_number)}/status`,
      {headers:{Accept:"application/json",Authorization:`Basic ${authBasic}`}}
    );
    const statusText=await statusResponse.text();
    let midtransStatus=null;try{midtransStatus=statusText?JSON.parse(statusText):null}catch{}
    if(!statusResponse.ok){
      return json({error:midtransStatus?.status_message||"Status pembayaran Midtrans tidak dapat diverifikasi."},502);
    }

    const transactionStatus=String(midtransStatus?.transaction_status||"").toLowerCase();
    if(["settlement","capture","authorize"].includes(transactionStatus)){
      return json({error:"Pembayaran sudah masuk/proses. Pesanan tidak dapat dibatalkan dari halaman ini."},409);
    }

    if(transactionStatus==="pending"){
      const cancelResponse=await fetch(
        `${base}/v2/${encodeURIComponent(order.order_number)}/cancel`,
        {method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Basic ${authBasic}`}}
      );
      const cancelText=await cancelResponse.text();
      let cancelData=null;try{cancelData=cancelText?JSON.parse(cancelText):null}catch{}
      if(!cancelResponse.ok){
        return json({error:cancelData?.status_message||cancelData?.message||"Midtrans menolak pembatalan pembayaran."},502);
      }
    }

    const rpcResponse=await fetch(url+"/rest/v1/rpc/buyer_cancel_order",{
      method:"POST",
      headers:{
        apikey:anonKey,
        Authorization:auth,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({p_order_id:order.id})
    });
    const rpcText=await rpcResponse.text();
    let rpcData=null;try{rpcData=rpcText?JSON.parse(rpcText):null}catch{rpcData={};}
    if(!rpcResponse.ok){
      return json({error:rpcData?.message||rpcData?.error||"Pesanan gagal dibatalkan."},rpcResponse.status);
    }
    return json(rpcData||{ok:true,order_id:order.id,status:"cancelled"});
  }catch(error){
    console.error("MarketKita buyer cancel:",error?.message||error);
    return json({error:error?.message||"Gagal membatalkan pesanan."},500);
  }
}
export async function onRequestGet(){return json({ok:true,service:"MarketKita Buyer Cancel"});}
