/* MarketKita P29 — Promotion Engine UI */
(function(){
"use strict";
function sb(){return window.marketKitaGetSupabase?.()||window.kwSupabase||null}
function user(){return window.marketKitaGetCurrentUser?.()||window.kwCurrentUser||null}
function subtotal(){return Array.isArray(window.cart)?window.cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.quantity||0),0):0}
async function api(path,opt={}){const s=sb(),u=user();if(!s||!u)throw new Error("LOGIN_REQUIRED");const session=(await s.auth.getSession()).data?.session;if(!session)throw new Error("LOGIN_REQUIRED");return fetch(path,{...opt,headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json",...(opt.headers||{})},cache:"no-store"})}
async function validate(){
 const input=document.getElementById("checkoutVoucher"),msg=document.getElementById("checkoutVoucherMessage");const code=String(input?.value||"").trim().toUpperCase();
 if(!code){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Masukkan kode voucher.";return}
 try{
  const r=await api("/api/buyer-promotions?subtotal="+encodeURIComponent(subtotal()));const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal memuat promosi.");
  const v=(d.vouchers||[]).find(x=>String(x.code).toUpperCase()===code);
  if(!v){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Voucher tidak tersedia, belum diklaim, atau tidak memenuhi syarat.";return}
  if(v.used){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Voucher sudah digunakan.";return}
  if(!v.claimed){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Klaim voucher ini dari Voucher Saya terlebih dahulu.";return}
  if(Number(v.estimated_discount||0)<=0&&subtotal()<Number(v.min_order_amount||0)){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Minimum transaksi belum terpenuhi.";return}
  window.marketCheckoutVoucherId=v.id;if(msg)msg.textContent="Voucher "+v.code+" siap digunakan. Diskon perkiraan "+(Number(v.estimated_discount||0)).toLocaleString("id-ID")+". Final dihitung server.";
 }catch(e){if(msg)msg.textContent=e.message==="LOGIN_REQUIRED"?"Login diperlukan untuk menggunakan voucher.":e.message||"Gagal memvalidasi voucher."}
}
async function claim(id){
 try{const r=await api("/api/buyer-promotions",{method:"POST",body:JSON.stringify({voucher_id:id})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Voucher gagal diklaim.");showKwNotice?.("Voucher berhasil masuk ke akun Anda.","Voucher berhasil");window.loadVouchers?.()}catch(e){showKwNotice?.(e.message||"Voucher gagal diklaim.","Voucher")}
}
window.validateCheckoutVoucher=validate;
window.claimVoucher=claim;
})();