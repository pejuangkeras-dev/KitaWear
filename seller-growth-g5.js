/* MarketKita G5 — Seller Growth Center */
(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const rupiah=v=>"Rp"+Number(v||0).toLocaleString("id-ID");
async function session(){const s=window.supabaseClient?.auth?.getSession?await window.supabaseClient.auth.getSession():await window.kwSupabase?.auth?.getSession?.();return s?.data?.session||null}
async function load(){
 const root=document.getElementById("g5Growth");if(!root)return;const s=await session();if(!s){root.innerHTML='<div class="notice">Login diperlukan.</div>';return}
 try{
  const r=await fetch("/api/seller-growth?days=30",{headers:{Authorization:"Bearer "+s.access_token},cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Gagal memuat data.");
  const sales=d.sales||{};const balance=d.balance||{};const summary=sales.summary||sales||{};const rows=Array.isArray(sales.daily)?sales.daily:Array.isArray(sales.rows)?sales.rows:[];
  const total=Number(summary.total_sales||summary.gross_sales||summary.total_revenue||0),orders=Number(summary.total_orders||summary.orders||0),items=Number(summary.total_items||summary.items||0);
  root.innerHTML='<div class="g5-grid"><div class="g5-kpi"><small>Penjualan 30 hari</small><strong>'+rupiah(total)+'</strong></div><div class="g5-kpi"><small>Pesanan</small><strong>'+orders.toLocaleString("id-ID")+'</strong></div><div class="g5-kpi"><small>Item terjual</small><strong>'+items.toLocaleString("id-ID")+'</strong></div><div class="g5-kpi"><small>Saldo tersedia</small><strong>'+rupiah(balance.available_balance||balance.available||balance.balance||0)+'</strong></div></div><div class="g5-tools"><button class="btn light" id="g5Reload">↻ Perbarui</button><span class="muted">Periode 30 hari terakhir</span></div><div class="tablewrap"><table class="table"><thead><tr><th>Hari</th><th>Pesanan</th><th>Penjualan</th><th>Item</th></tr></thead><tbody>'+(rows.length?rows.map(x=>'<tr><td>'+esc(x.date||x.day||x.created_at||"-")+'</td><td>'+esc(x.orders||x.order_count||0)+'</td><td>'+rupiah(x.sales||x.revenue||x.gross_sales||0)+'</td><td>'+esc(x.items||x.item_count||0)+'</td></tr>').join(""):'<tr><td colspan="4" class="empty">Belum ada data harian.</td></tr>')+'</tbody></table></div>';
  document.getElementById("g5Reload")?.addEventListener("click",load);
 }catch(e){root.innerHTML='<div class="notice">'+esc(e.message||"Gagal memuat growth center.")+'</div>'}
}
function mount(){if(document.getElementById("g5Growth"))return;const anchor=document.querySelector("#sellerPanel .stats");if(!anchor)return;const sec=document.createElement("div");sec.id="g5Growth";sec.className="card wide";sec.style.marginTop="18px";sec.innerHTML='<h2>Seller Growth Center</h2><p class="muted">Pantau performa penjualan dan saldo seller dari data server.</p><div class="notice">Memuat metrik...</div>';anchor.parentElement.insertBefore(sec,anchor.nextSibling);load()}
window.addEventListener("load",()=>setTimeout(mount,350));
})();