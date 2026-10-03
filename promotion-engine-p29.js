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
  const list=await api("/api/buyer-promotions?subtotal="+encodeURIComponent(subtotal()));const ld=await list.json();if(!list.ok)throw new Error(ld.error||"Gagal memuat promosi.");
  const v=(ld.vouchers||[]).find(x=>String(x.code).toUpperCase()===code);
  if(!v){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Voucher tidak tersedia atau belum diklaim.";return}
  if(v.used){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Voucher sudah digunakan.";return}
  if(!v.claimed){window.marketCheckoutVoucherId=null;if(msg)msg.textContent="Klaim voucher ini dari Voucher Saya terlebih dahulu.";return}
  const productIds=[...new Set((window.cart||[]).map(x=>x.product_id).filter(Boolean))];
  const storeIds=[...new Set((window.cart||[]).map(x=>x.store_id).filter(Boolean))];
  const vr=await api("/api/buyer-promotions",{method:"POST",body:JSON.stringify({action:"validate",voucher_id:v.id,subtotal:subtotal(),product_ids:productIds,store_ids:storeIds})});
  const vd=await vr.json();if(!vr.ok||!vd.promotion?.valid){window.marketCheckoutVoucherId=null;const codeMap={PROMOTION_NOT_ELIGIBLE:"Voucher tidak berlaku untuk produk/toko pada keranjang ini.",FIRST_ORDER_ONLY:"Voucher ini hanya berlaku untuk pesanan pertama.",MIN_ORDER_NOT_MET:"Minimum transaksi voucher belum terpenuhi.",VOUCHER_NOT_CLAIMED:"Klaim voucher terlebih dahulu.",VOUCHER_ALREADY_USED:"Voucher sudah digunakan.",VOUCHER_UNAVAILABLE:"Voucher tidak tersedia atau sudah kedaluwarsa."};if(msg)msg.textContent=codeMap[vd.promotion?.code]||vd.error||"Voucher tidak memenuhi syarat.";return}
  window.marketCheckoutVoucherId=v.id;if(msg)msg.textContent="Voucher "+v.code+" siap digunakan. Diskon "+Number(vd.promotion.discount_amount||0).toLocaleString("id-ID")+".";
 }catch(e){if(msg)msg.textContent=e.message==="LOGIN_REQUIRED"?"Login diperlukan untuk menggunakan voucher.":e.message||"Gagal memvalidasi voucher."}
}
async function claim(id){
 try{const r=await api("/api/buyer-promotions",{method:"POST",body:JSON.stringify({voucher_id:id})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Voucher gagal diklaim.");showKwNotice?.("Voucher berhasil masuk ke akun Anda.","Voucher berhasil");window.loadVouchers?.()}catch(e){showKwNotice?.(e.message||"Voucher gagal diklaim.","Voucher")}
}
window.validateCheckoutVoucher=validate;
window.claimVoucher=claim;
})();