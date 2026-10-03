(()=>{"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rp=v=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0));
async function token(){try{return (await window.kwSupabase?.auth?.getSession())?.data?.session?.access_token||""}catch{return""}}
async function load(){
 const box=document.getElementById("g9OperationsBody");if(!box)return;
 const nav=document.getElementById("g9BiLink");if(nav)nav.innerHTML='<a href="/admin-bi-g10.html">📊 Buka Marketplace BI (G10)</a>';
 box.innerHTML='<div class="g9-loading">Memuat operational health...</div>';
 try{
  const t=await token();if(!t)throw Error("Sesi admin tidak ditemukan.");
  const r=await fetch("/api/admin-operations",{headers:{Authorization:"Bearer "+t,Accept:"application/json"},cache:"no-store"});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Gagal memuat operational health.");
  const s=d.summary||{}, status=d.order_status||{};
  const cards=[
   ["Pesanan dipantau",s.orders,""],
   ["Belum dibayar",s.unpaid,s.unpaid?"attention":""],
   ["Retur terbuka",s.open_returns,s.open_returns?"attention":""],
   ["Sengketa terbuka",s.open_disputes,s.open_disputes?"attention":""],
   ["Refund pending",s.pending_refunds,s.pending_refunds?"attention":""],
   ["Payout pending",s.pending_payouts,s.pending_payouts?"attention":""],
   ["Nilai payout pending",rp(s.pending_payout_amount),""],
   ["Shipment exception",s.shipment_exceptions,s.shipment_exceptions?"attention":""],
   ["Event tracking / 24 jam",s.tracking_events_24h,""]
  ];
  box.innerHTML='<div class="g9-grid">'+cards.map(x=>'<div class="g9-card '+x[2]+'"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join("")+'</div>'+
   '<div class="g9-foot"><div><b>Status order</b><div class="g9-status-list">'+Object.entries(status).map(([k,v])=>'<span><em>'+esc(k)+'</em> '+esc(v)+'</span>').join("")+'</div></div><small>Snapshot: '+esc(new Date(d.timestamp).toLocaleString("id-ID"))+' · '+esc(d.scope)+'</small></div>';
 }catch(e){box.innerHTML='<div class="g9-error">'+esc(e.message)+'</div>'}
}
window.loadG9Operations=load;
function boot(){if(document.getElementById("g9OperationsBody"))load();else setTimeout(boot,500)}
boot();
})();