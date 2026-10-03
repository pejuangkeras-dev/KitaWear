(()=>{"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?String(v||""):d.toLocaleString("id-ID")};
async function token(){try{return (await window.kwSupabase?.auth?.getSession())?.data?.session?.access_token||""}catch{return""}}
function close(){document.getElementById("g8TimelineModal")?.remove()}
async function open(order){
 const modal=document.createElement("div");modal.id="g8TimelineModal";modal.className="mk-track-modal";modal.innerHTML='<div class="mk-track-box"><div class="mk-track-head"><div><h3>Timeline Pesanan</h3><small style="color:#777">Riwayat pembayaran, proses pesanan, dan pengiriman</small></div><button class="mk-track-close" type="button" aria-label="Tutup">×</button></div><div id="g8TimelineBody" class="account-empty">Memuat timeline...</div></div>';document.body.appendChild(modal);
 modal.onclick=e=>{if(e.target===modal)close()};modal.querySelector(".mk-track-close").onclick=close;
 try{
  const t=await token();if(!t)throw Error("Sesi login sudah berakhir.");
  const r=await fetch("/api/order-timeline?order_id="+encodeURIComponent(order.id),{headers:{Authorization:"Bearer "+t,Accept:"application/json"},cache:"no-store"});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Gagal memuat timeline.");
  const a=Array.isArray(d.timeline?.order_status_events)?d.timeline.order_status_events:[],s=Array.isArray(d.timeline?.shipping_events)?d.timeline.shipping_events:[];
  const events=[];
  for(const x of a)events.push({at:x.changed_at,title:"Status pesanan",text:[x.old_status?"Dari "+x.old_status:"",x.new_status?"menjadi "+x.new_status:"",x.new_payment_status?"Pembayaran: "+x.new_payment_status:"",x.new_shipping_status?"Pengiriman: "+x.new_shipping_status:""].filter(Boolean).join(" · "),kind:"order"});
  for(const x of s)events.push({at:x.event_at,title:"Pengiriman",text:[x.description||x.status,x.city].filter(Boolean).join(" · "),kind:"shipping"});
  events.sort((x,y)=>new Date(y.at)-new Date(x.at));
  const shipments=Array.isArray(d.timeline?.shipments)?d.timeline.shipments:[];
  const body=document.getElementById("g8TimelineBody");
  body.innerHTML='<div class="mk-track-summary"><div><span>Pesanan</span><strong>'+esc(d.order_number||order.order_number)+'</strong></div><div><span>Event</span><strong>'+events.length+'</strong></div><div><span>Pengiriman</span><strong>'+shipments.length+'</strong></div><div><span>Status</span><strong>'+esc(order.status||"-")+'</strong></div></div>'+(events.length?events.map(e=>'<div class="mk-track-event"><strong>'+esc(e.title)+'</strong><div>'+esc(e.text||"Pembaruan status")+'</div><small>'+esc(fmt(e.at))+'</small></div>').join(""):'<div class="account-empty">Belum ada event tersimpan untuk pesanan ini.</div>');
 }catch(e){const b=document.getElementById("g8TimelineBody");if(b)b.innerHTML='<div class="account-empty">Gagal memuat timeline: '+esc(e.message)+'</div>'}
}
function decorate(){
 const root=document.getElementById("buyerOrdersList");if(!root)return;
 const cache=Array.isArray(window.buyerOrdersCache)?window.buyerOrdersCache:[];
 root.querySelectorAll(".buyer-order-card").forEach(card=>{
   if(card.querySelector("[data-g8-timeline]"))return;
   const orderNo=card.querySelector(".buyer-order-head strong")?.textContent?.trim();
   const order=cache.find(x=>String(x.order_number||"")===String(orderNo||""));
   if(!order)return;
   const box=card.querySelector(".buyer-tracking");if(!box)return;
   const b=document.createElement("button");b.type="button";b.dataset.g8Timeline="1";b.className="buyer-order-confirm";b.style.cssText="margin-top:8px;background:#fff;border:1px solid var(--line);color:#222";b.textContent="🕒 Lihat Timeline Lengkap";b.onclick=()=>open(order);box.appendChild(b);
 });
}
function boot(){if(!window.kwSupabase)return setTimeout(boot,500);const root=document.getElementById("buyerOrdersList");if(root&&!root.__g8Observed){new MutationObserver(decorate).observe(root,{childList:true,subtree:true});root.__g8Observed=true;decorate()}else setTimeout(boot,800)}
window.closeG8Timeline=close;boot();
})();