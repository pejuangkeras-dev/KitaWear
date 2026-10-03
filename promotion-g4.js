/* MarketKita G4 — Centralized Promotion Engine UI */
(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const rupiah=v=>"Rp"+Number(v||0).toLocaleString("id-ID");
function ensureBox(){
 let el=document.getElementById("checkoutPromotionSummary");
 if(el)return el;
 const msg=document.getElementById("checkoutVoucherMessage");
 if(!msg?.parentElement)return null;
 el=document.createElement("div");el.id="checkoutPromotionSummary";el.className="mk-g4-promo";
 msg.parentElement.appendChild(el);return el;
}
function session(){return window.kwSupabase?.auth?.getSession?window.kwSupabase.auth.getSession():Promise.resolve({data:{session:null}})}
function items(){
 return (window.cart||[]).map(x=>({product_id:x.product_id||window.products?.[x.productIndex]?.id,store_id:x.store_id||window.products?.[x.productIndex]?.store_id,quantity:Number(x.quantity||0),unit_price:Number(x.price||0)})).filter(x=>x.product_id&&x.store_id&&x.quantity>0);
}
function subtotal(){return items().reduce((s,x)=>s+x.unit_price*x.quantity,0)}
async function refresh(){
 const root=ensureBox();if(!root||!window.kwCurrentUser)return;
 const {data}=await session();if(!data?.session)return;
 const shipping=Number(window.marketCheckoutShippingFee||0);
 const voucherId=window.marketCheckoutVoucherId||null;
 root.innerHTML='<div class="mk-g4-loading">Mencari promo terbaik untuk keranjang…</div>';
 try{
  const r=await fetch("/api/promotion-engine",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+data.session.access_token},body:JSON.stringify({items:items(),subtotal:subtotal(),shipping_fee:shipping,voucher_id:voucherId})});
  const d=await r.json();if(!r.ok||!d.promotion)throw new Error(d.error||"Promo tidak tersedia.");
  const p=d.promotion,selected=Array.isArray(p.selected_campaigns)?p.selected_campaigns:[];
  window.marketPromotionCampaignIds=Array.isArray(p.campaign_ids)?p.campaign_ids:[];
  window.marketPromotionPreview=p;
  const discount=Number(p.discount_amount||0),ship=Number(p.shipping_discount_amount||0),cashback=Number(p.cashback_amount||0);
  root.innerHTML=selected.length
   ? '<div class="mk-g4-head"><strong>Promo otomatis</strong><span>'+esc(selected.length+' promo terpilih')+'</span></div>'+selected.map(x=>'<div class="mk-g4-row"><span>'+esc(x.name||"Promo")+'</span><strong>-'+rupiah(Number(x.discount_amount||0)+Number(x.shipping_discount_amount||0))+'</strong></div>').join('')+(cashback?'<div class="mk-g4-cashback">Cashback estimasi '+rupiah(cashback)+'</div>':'')
   : '<div class="mk-g4-empty">Belum ada promo otomatis yang cocok untuk keranjang ini.</div>';
  const total=Math.max(0,subtotal()-Number(window.marketCheckoutVoucherId?0:0)-discount+shipping-ship);
  const voucherText=Number(window.marketCheckoutVoucherDiscount||0);
  const totalEl=document.getElementById("checkoutTotal");
  if(totalEl && !window.marketCheckoutVoucherId) totalEl.textContent=rupiah(total);
  if(window.marketCheckoutVoucherId && typeof window.calculateCheckoutTotalDisplay==="function")window.calculateCheckoutTotalDisplay();
 }catch(e){root.innerHTML='<div class="mk-g4-empty">'+esc(e.message||"Promo belum dapat dihitung.")+'</div>';window.marketPromotionCampaignIds=[];}
}
window.marketG4RefreshPromotions=refresh;
const oldOpen=window.openCheckout;
if(typeof oldOpen==="function"){window.openCheckout=function(){const r=oldOpen.apply(this,arguments);setTimeout(refresh,50);return r;};}
const oldVoucher=window.validateCheckoutVoucher;
if(typeof oldVoucher==="function"){window.validateCheckoutVoucher=async function(){const r=await oldVoucher.apply(this,arguments);setTimeout(refresh,30);return r;};}
const oldShipping=window.calculateCheckoutShipping;
if(typeof oldShipping==="function"){window.calculateCheckoutShipping=async function(){const r=await oldShipping.apply(this,arguments);setTimeout(refresh,80);return r;};}
window.addEventListener("load",()=>setTimeout(refresh,500));
})();