function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
const clean=v=>String(v??"").trim();
async function authUser(ctx){
 const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(ctx.env.SUPABASE_ANON_KEY),h=ctx.request.headers.get("Authorization")||"";
 if(!base||!anon||!/^Bearer\s+/i.test(h))return null;
 const r=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:h}});
 return r.ok?r.json().catch(()=>null):null;
}
async function service(ctx,path,opt={}){
 const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),key=clean(ctx.env.SUPABASE_SERVICE_ROLE_KEY);
 if(!base||!key)throw Error("Konfigurasi Supabase server belum lengkap.");
 const r=await fetch(base+path,{...opt,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(opt.headers||{})}});
 const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}};
 if(!r.ok)throw Error(d?.message||d?.details||d?.hint||d?.error||("Supabase HTTP "+r.status));
 return d;
}
async function userRpc(ctx,name,args){
 const base=clean(ctx.env.SUPABASE_URL).replace(/\/+$/,""),anon=clean(ctx.env.SUPABASE_ANON_KEY),h=ctx.request.headers.get("Authorization")||"";
 const r=await fetch(base+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:anon,Authorization:h,"Content-Type":"application/json"},body:JSON.stringify(args)});
 const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}};
 if(!r.ok)throw Error(d?.message||d?.details||d?.hint||d?.error||("Supabase RPC "+r.status));
 return d;
}
async function profile(ctx,id){
 const rows=await service(ctx,"/rest/v1/profiles?select=id,role,full_name&id=eq."+encodeURIComponent(id)+"&limit=1");
 return rows?.[0]||null;
}
export async function onRequestGet(ctx){
 try{
  const u=await authUser(ctx);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
  const p=await profile(ctx,u.id);if(!p)return json({error:"PROFILE_REQUIRED"},403);
  const role=clean(p.role).toLowerCase();
  if(role==="seller"){
   const summary=await userRpc(ctx,"seller_balance_summary",{});
   const [requests,payouts,transactions]=await Promise.all([
    service(ctx,"/rest/v1/seller_payout_requests?select=id,amount,status,note,admin_note,requested_at,reviewed_at,paid_at&seller_id=eq."+encodeURIComponent(u.id)+"&order=requested_at.desc&limit=50"),
    service(ctx,"/rest/v1/seller_payouts?select=id,order_id,gross_amount,platform_fee,net_amount,status,paid_at,created_at&seller_id=eq."+encodeURIComponent(u.id)+"&order=created_at.desc&limit=100"),
    service(ctx,"/rest/v1/ledger_transactions?select=id,transaction_type,amount,status,description,source_type,source_id,created_at&seller_id=eq."+encodeURIComponent(u.id)+"&order=created_at.desc&limit=100")
   ]);
   return json({ok:true,role,summary:summary||{},payout_requests:requests||[],payouts:payouts||[],transactions:transactions||[]});
  }
  if(role!=="admin")return json({error:"SELLER_OR_ADMIN_REQUIRED"},403);
  const [txns,entries,payoutRequests,audits]=await Promise.all([
   service(ctx,"/rest/v1/ledger_transactions?select=id,transaction_type,amount,status,order_id,seller_id,source_type,source_id,description,created_at&order=created_at.desc&limit=200"),
   service(ctx,"/rest/v1/ledger_entries?select=transaction_id,direction,amount&limit=2000"),
   service(ctx,"/rest/v1/seller_payout_requests?select=id,seller_id,amount,status,note,admin_note,requested_at,reviewed_at,paid_at&order=requested_at.desc&limit=100"),
   service(ctx,"/rest/v1/seller_payout_audit?select=id,payout_request_id,seller_id,admin_id,action,previous_status,new_status,amount,admin_note,created_at&order=created_at.desc&limit=200")
  ]);
  const sums=new Map();(entries||[]).forEach(e=>{const x=sums.get(e.transaction_id)||{debit:0,credit:0};x[e.direction]=(x[e.direction]||0)+Number(e.amount||0);sums.set(e.transaction_id,x)});
  let unbalanced=0;for(const t of txns||[]){const x=sums.get(t.id)||{debit:0,credit:0};if(x.debit!==x.credit)unbalanced++}
  const byType=(type)=> (txns||[]).filter(x=>x.transaction_type===type&&x.status==="posted").reduce((n,x)=>n+Number(x.amount||0),0);
  const sellerPayable=(txns||[]).filter(x=>x.transaction_type==="order_payment"&&x.status==="posted").reduce((n,x)=>n,0);
  return json({ok:true,role,summary:{transactions:(txns||[]).length,entries:(entries||[]).length,unbalanced,payments:byType("order_payment"),refunds:byType("refund"),payouts:byType("seller_payout"),seller_payable:0},payout_requests:payoutRequests||[],payout_audit:audits||[],transactions:txns||[]});
 }catch(e){return json({error:e.message||"Gagal memuat finance."},500)}
}
export async function onRequestPost(ctx){
 try{
  const u=await authUser(ctx);if(!u?.id)return json({error:"LOGIN_REQUIRED"},401);
  const p=await profile(ctx,u.id);if(!p)return json({error:"PROFILE_REQUIRED"},403);
  if(Number(ctx.request.headers.get("Content-Length")||0)>16384)return json({error:"Payload terlalu besar."},413);
  const b=await ctx.request.json().catch(()=>null);if(!b||typeof b!=="object"||Array.isArray(b))return json({error:"Payload tidak valid."},400);
  const action=clean(b.action).toLowerCase();
  if(action==="request_payout"){
   if(clean(p.role).toLowerCase()!=="seller")return json({error:"SELLER_REQUIRED"},403);
   const amount=Number(b.amount);if(!Number.isInteger(amount)||amount<=0)return json({error:"Nominal payout harus bilangan bulat positif."},400);
   const result=await userRpc(ctx,"seller_request_payout",{p_amount:amount,p_note:clean(b.note)||null});
   return json({ok:true,action,result});
  }
  if(action==="review_payout"){
   if(clean(p.role).toLowerCase()!=="admin")return json({error:"ADMIN_REQUIRED"},403);
   const id=clean(b.request_id),decision=clean(b.decision).toLowerCase();
   if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"request_id tidak valid."},400);
   if(!["approved","rejected","paid"].includes(decision))return json({error:"Keputusan payout tidak valid."},400);
   const result=await userRpc(ctx,"admin_review_payout_request",{p_request_id:id,p_decision:decision,p_admin_note:clean(b.admin_note)||null});
   return json({ok:true,action,result});
  }
  return json({error:"Action finance tidak valid."},400);
 }catch(e){return json({error:e.message||"Gagal memproses finance."},409)}
}