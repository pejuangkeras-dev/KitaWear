(()=>{
let state={quoteId:null,sellers:[],selected:{},loading:false};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rp=v=>"Rp"+Number(v||0).toLocaleString("id-ID");
function box(){let x=document.getElementById("mkShippingBox");if(x)return x;const ref=document.getElementById("buyerAddress");if(!ref)return null;x=document.createElement("div");x.id="mkShippingBox";x.style.cssText="margin:12px 0;padding:14px;border:1px solid #ded9cf;border-radius:14px;background:#fffdf9";ref.closest(".field")?.after(x);return x;}
function render(){
 const x=box();if(!x)return;
 if(state.loading){x.innerHTML="<strong>🚚 Menghitung ongkir…</strong><div style='font-size:11px;color:#777;margin-top:5px'>Mengambil tarif kurir dari Biteship.</div>";updateShippingSummary("Menghitung…");updatePayState();return;}
 if(!state.sellers.length){x.innerHTML="<strong>🚚 Pengiriman otomatis</strong><div style='font-size:11px;color:#777;margin-top:5px'>Pilih alamat tersimpan untuk menghitung pilihan kurir.</div>";updateShippingSummary("Menunggu alamat");updatePayState();return;}
 let total=0;
 const html=state.sellers.map(g=>{
  const sel=state.selected[g.store_id]; total+=Number(sel?.price||0);
  return "<div style='margin-top:12px'><strong style='font-size:13px'>"+esc(g.store_name)+"</strong>"+g.options.map(o=>{
   const id=g.store_id+"|"+o.courier_company+"|"+o.courier_type;
   const checked=sel&&sel.courier_company===o.courier_company&&sel.courier_type===o.courier_type;
   return "<label style='display:flex;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #eee;cursor:pointer'><input type='radio' name='mkship_"+esc(g.store_id)+"' "+(checked?"checked":"")+" data-mkship='"+esc(id)+"'><span style='flex:1'><strong>"+esc(o.courier_name)+" · "+esc(o.service_name)+"</strong><small style='display:block;color:#777'>"+esc(o.duration||"")+"</small></span><b>"+rp(o.price)+"</b></label>";
  }).join("")+"</div>";
 }).join("");
 x.innerHTML="<strong>🚚 Pilih pengiriman</strong>"+html+"<div style='display:flex;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid #ded9cf'><span>Total ongkir</span><strong>"+rp(total)+"</strong></div>";
 x.querySelectorAll("[data-mkship]").forEach(el=>el.addEventListener("change",()=>{const [store,company,type]=el.dataset.mkship.split("|");const g=state.sellers.find(x=>String(x.store_id)===store);const o=g?.options.find(x=>x.courier_company===company&&x.courier_type===type);if(o)state.selected[store]={...o,store_id:store,store_name:g.store_name};render();updateTotal(totalShipping());}));
}
function totalShipping(){return Object.values(state.selected).reduce((a,x)=>a+Number(x.price||0),0);}
function updateShippingSummary(message,amount=null){
 const el=document.getElementById("checkoutShippingSummary");if(!el)return;
 el.innerHTML=amount!=null?"<span>Ongkir</span><strong>"+rp(amount)+"</strong>":"<span>Ongkir</span><strong>"+esc(message||"Menunggu perhitungan")+"</strong>";
}
function updatePayState(){
 const btn=document.getElementById("payButton");if(!btn)return;
 const ready=Boolean(state.quoteId&&state.sellers.length&&Object.keys(state.selected).length===state.sellers.length);
 btn.disabled=!ready;
 btn.title=ready?"":"Pilih alamat dan tunggu ongkir tersedia.";
}
function updateTotal(ship=totalShipping()){
 const base=((typeof cart!=="undefined"?cart:[])||[]).reduce((s,x)=>s+Number(x.price||0)*Number(x.quantity||0),0);
 const el=document.getElementById("checkoutTotal");if(el)el.textContent=rp(base+ship);
 updateShippingSummary(null,ship);updatePayState();
}
async function sessionToken(){try{const s=(typeof kwSupabase!=="undefined"&&kwSupabase?.auth)?await kwSupabase.auth.getSession():null;return s?.data?.session?.access_token||"";}catch{return"";}}
async function quote(){
 const select=document.getElementById("buyerAddressSelect"),id=select?.value;if(!id||!Array.isArray(typeof cart!=="undefined"?cart:null)||!cart.length){state={quoteId:null,sellers:[],selected:{},loading:false};render();return;}
 state.loading=true;render();
 try{
  const token=await sessionToken();if(!token)throw new Error("Silakan login untuk menghitung ongkir.");
  const r=await fetch("/api/shipping-quote",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({address_id:id,items:(typeof cart!=="undefined"?cart:[]).map(x=>({product_id:x.product_id||(typeof products!=="undefined"?products:[])?.[x.productIndex]?.id,size:x.size,quantity:x.quantity}))})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Gagal menghitung ongkir.");
  state.quoteId=d.quote_id;state.sellers=d.sellers||[];state.selected={};
  for(const g of state.sellers){const o=g.options?.[0];if(o)state.selected[g.store_id]={...o,store_id:g.store_id,store_name:g.store_name};}
  state.loading=false;render();updateTotal();updatePayState();
 }catch(e){state.loading=false;state.sellers=[];state.selected={};render();const x=box();if(x)x.innerHTML="<strong>⚠️ Ongkir belum tersedia</strong><div style='font-size:11px;color:#777;margin-top:5px'>"+esc(e.message||"Periksa alamat dan data pickup seller.")+"</div>";updateShippingSummary(e.message||"Tidak tersedia");const t=document.getElementById("checkoutTotal");if(t)t.textContent=rp(((typeof cart!=="undefined"?cart:[])||[]).reduce((s,x)=>s+Number(x.price||0)*Number(x.quantity||0),0));updatePayState();}
}
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
 const url=typeof input==="string"?input:input?.url||"";
 if(url.includes("/api/create-transaction")&&init?.body){
  try{const p=JSON.parse(init.body);if(state.quoteId){p.shipping_quote_id=state.quoteId;p.shipping_selections=Object.values(state.selected).map(x=>({store_id:x.store_id,courier_company:x.courier_company,courier_type:x.courier_type}));init={...init,body:JSON.stringify(p)};}}
  catch{}
 }
 return originalFetch(input,init);
};
function scheduleQuote(){
 [0,150,500,1200].forEach(ms=>setTimeout(()=>{quote();},ms));
}
function wrap(){
 if(typeof window.openCheckout==="function"&&!window.openCheckout.__mkWrapped){
  const o=window.openCheckout;
  window.openCheckout=function(){const r=o.apply(this,arguments);scheduleQuote();return r};
  window.openCheckout.__mkWrapped=true;
 }
 if(typeof window.applyCheckoutAddress==="function"&&!window.applyCheckoutAddress.__mkWrapped){
  const o=window.applyCheckoutAddress;
  window.applyCheckoutAddress=function(id){const r=o.apply(this,arguments);scheduleQuote();return r};
  window.applyCheckoutAddress.__mkWrapped=true;
 }
 if(typeof window.closeCheckout==="function"&&!window.closeCheckout.__mkWrapped){
  const o=window.closeCheckout;
  window.closeCheckout=function(){state={quoteId:null,sellers:[],selected:{},loading:false};return o.apply(this,arguments)};
  window.closeCheckout.__mkWrapped=true;
 }
}
function bindAddressChange(){
 const select=document.getElementById("buyerAddressSelect");
 if(!select||select.__mkShippingBound)return;
 select.addEventListener("change",()=>scheduleQuote());
 select.__mkShippingBound=true;
}
setInterval(()=>{wrap();bindAddressChange();},300);
document.addEventListener("DOMContentLoaded",()=>{wrap();bindAddressChange();});
})();