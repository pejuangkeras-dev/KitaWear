/* MarketKita P28 — Buyer Experience */
(function(){
"use strict";
const getSb=()=>window.marketKitaGetSupabase?.()||window.kwSupabase||null;
const getUser=()=>window.marketKitaGetCurrentUser?.()||window.kwCurrentUser||null;
let root, panel, lastUserId=null;

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const money=v=>"Rp "+Number(v||0).toLocaleString("id-ID");
const statusMap={pending_payment:"Menunggu pembayaran",paid:"Dibayar",processing:"Diproses",shipped:"Dikirim",delivered:"Tiba",completed:"Selesai",cancelled:"Dibatalkan",refunded:"Refund",disputed:"Sengketa"};
const notice=(title,msg)=>{window.alert(title+"\n\n"+msg)};
function ensureUI(){
 if(document.getElementById("mk-p28-root"))return;
 const style=document.createElement("style");style.textContent=`
#mk-p28-root{position:fixed;inset:0;z-index:9990;display:none;background:rgba(0,0,0,.42)}
#mk-p28-root.show{display:block}
#mk-p28-panel{position:absolute;right:0;top:0;height:100%;width:min(620px,96vw);background:#fffdf9;overflow:auto;padding:22px;box-shadow:-20px 0 60px rgba(0,0,0,.18)}
.mk28-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-22px;background:#fffdf9;padding:4px 0 16px;z-index:2}
.mk28-head h2{margin:0;font-size:25px}.mk28-close{border:1px solid #ddd8cf;background:#fff;border-radius:10px;width:40px;height:40px}
.mk28-tabs{display:flex;gap:7px;overflow:auto;padding-bottom:12px}.mk28-tab{white-space:nowrap;border:1px solid #ddd8cf;background:#fff;border-radius:999px;padding:9px 13px;font-weight:800;font-size:12px}.mk28-tab.active{background:#171817;color:#fff}
.mk28-section{display:none}.mk28-section.active{display:block}
.mk28-card{background:#fff;border:1px solid #e2ddd4;border-radius:15px;padding:14px;margin:10px 0}
.mk28-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.mk28-muted{color:#777;font-size:12px}.mk28-btn{border:0;background:#171817;color:#fff;border-radius:9px;padding:9px 12px;font-weight:800;font-size:12px}.mk28-btn.light{background:#f0ede7;color:#222}.mk28-btn.danger{background:#9f2929}
.mk28-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.mk28-field label{display:block;font-size:11px;font-weight:800;margin-bottom:5px}.mk28-field input{width:100%;height:40px;border:1px solid #ddd8cf;border-radius:9px;padding:0 10px;background:#fff}.mk28-full{grid-column:1/-1}
.mk28-order-items{margin-top:10px;border-top:1px solid #eee9e1}.mk28-item{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #eee9e1;font-size:12px}
.mk28-pill{display:inline-block;border-radius:999px;background:#eeeae3;padding:5px 8px;font-size:10px;font-weight:800}
.mk28-empty{padding:25px;text-align:center;color:#777;border:1px dashed #d9d3c9;border-radius:14px}
.mk28-badge{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#b3261e;color:#fff;font-size:9px;margin-left:3px}
@media(max-width:520px){#mk-p28-panel{padding:16px}.mk28-head{top:-16px}.mk28-grid{grid-template-columns:1fr}.mk28-full{grid-column:auto}}
`;document.head.appendChild(style);
 root=document.createElement("div");root.id="mk-p28-root";root.innerHTML=`<aside id="mk-p28-panel" aria-label="Akun MarketKita">
<div class="mk28-head"><h2>Akun Saya</h2><button class="mk28-close" id="mk28-close">×</button></div>
<div class="mk28-tabs">
<button class="mk28-tab active" data-tab="home">Ringkasan</button><button class="mk28-tab" data-tab="orders">Pesanan</button><button class="mk28-tab" data-tab="addresses">Alamat</button><button class="mk28-tab" data-tab="wishlist">Favorit</button><button class="mk28-tab" data-tab="reviews">Ulasan</button><button class="mk28-tab" data-tab="notifications">Notifikasi</button>
</div>
<div id="mk28-home" class="mk28-section active"></div><div id="mk28-orders" class="mk28-section"></div><div id="mk28-addresses" class="mk28-section"></div><div id="mk28-wishlist" class="mk28-section"></div><div id="mk28-reviews" class="mk28-section"></div><div id="mk28-notifications" class="mk28-section"></div>
</aside>`;document.body.appendChild(root);
 root.addEventListener("click",e=>{if(e.target===root||e.target.id==="mk28-close")close();const t=e.target.closest("[data-tab]");if(t)switchTab(t.dataset.tab)});
}
function addAccountButton(){
 const actions=document.querySelector(".actions");if(!actions||document.getElementById("mk28-account"))return;
 const b=document.createElement("button");b.id="mk28-account";b.className="icon-btn";b.title="Akun Saya";b.innerHTML="♙";b.onclick=open;
 actions.insertBefore(b,actions.firstChild);
}
async function open(){ensureUI();const sb=getSb(),u=getUser();if(!u){location.href="/?login=1";return}root.classList.add("show");await refresh();}
function close(){root?.classList.remove("show")}
function switchTab(tab){document.querySelectorAll(".mk28-tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===tab));document.querySelectorAll(".mk28-section").forEach(x=>x.classList.toggle("active",x.id==="mk28-"+tab));loadTab(tab)}
async function refresh(){switchTab("home");await Promise.allSettled([loadHome(),loadOrders(),loadAddresses(),loadWishlist(),loadReviews(),loadNotifications()])}
async function loadHome(){const el=document.getElementById("mk28-home");const sb=getSb(),u=getUser();if(!sb||!u)return;
 const [o,w,n,a]=await Promise.all([sb.from("orders").select("id,status,total,created_at").eq("buyer_id",u.id).order("created_at",{ascending:false}).limit(5),sb.from("wishlists").select("product_id",{count:"exact",head:true}).eq("user_id",u.id),sb.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",u.id).is("read_at",null),sb.from("buyer_addresses").select("id",{count:"exact",head:true}).eq("user_id",u.id)]);
 el.innerHTML=`<div class="mk28-card"><strong>Selamat datang kembali</strong><div class="mk28-muted" style="margin-top:5px">${esc(u.email||"")}</div></div>
 <div class="mk28-grid"><div class="mk28-card"><strong>${o.data?.length||0}</strong><div class="mk28-muted">Pesanan terbaru</div></div><div class="mk28-card"><strong>${w.count||0}</strong><div class="mk28-muted">Favorit</div></div><div class="mk28-card"><strong>${a.count||0}</strong><div class="mk28-muted">Alamat tersimpan</div></div><div class="mk28-card"><strong>${n.count||0}</strong><div class="mk28-muted">Notifikasi belum dibaca</div></div></div>
 <div class="mk28-card"><strong>Pesanan terbaru</strong>${(o.data||[]).map(x=>`<div class="mk28-row" style="padding-top:12px"><span>#${esc(String(x.id).slice(0,8))}<br><small class="mk28-muted">${new Date(x.created_at).toLocaleString("id-ID")}</small></span><span><b>${money(x.total)}</b><br><span class="mk28-pill">${esc(statusMap[x.status]||x.status)}</span></span></div>`).join("")||'<div class="mk28-empty">Belum ada pesanan.</div>'}</div>`;
}
async function loadOrders(){const el=document.getElementById("mk28-orders"),sb=getSb(),u=getUser();if(!sb||!u)return;el.innerHTML='<div class="mk28-empty">Memuat pesanan...</div>';
 const q=await sb.from("orders").select("id,order_number,status,payment_status,total,created_at,shipping_recipient_name,shipping_address_line,shipping_city,shipping_province,shipping_postal_code").eq("buyer_id",u.id).order("created_at",{ascending:false}).limit(50);if(q.error){el.innerHTML='<div class="mk28-empty">'+esc(q.error.message)+'</div>';return}
 const ids=(q.data||[]).map(x=>x.id);let items=[];
 if(ids.length){const iq=await sb.from("order_items").select("order_id,product_id,product_name,size,quantity,unit_price,line_total").in("order_id",ids);if(!iq.error)items=iq.data||[]}
 let ship=[];if(ids.length){const sq=await sb.from("shipping_shipments").select("order_id,provider_tracking_id,waybill_id,courier_company,courier_type,status,tracking_url,updated_at").in("order_id",ids);if(!sq.error)ship=sq.data||[]}
 el.innerHTML=(q.data||[]).map(o=>{const its=items.filter(i=>i.order_id===o.id),ss=ship.filter(s=>s.order_id===o.id);return `<div class="mk28-card"><div class="mk28-row"><div><strong>${esc(o.order_number||String(o.id).slice(0,8))}</strong><div class="mk28-muted">${new Date(o.created_at).toLocaleString("id-ID")}</div></div><div style="text-align:right"><b>${money(o.total)}</b><br><span class="mk28-pill">${esc(statusMap[o.status]||o.status)}</span></div></div><div class="mk28-order-items">${its.map(i=>`<div class="mk28-item"><span>${esc(i.product_name)} × ${i.quantity}${i.size?" · "+esc(i.size):""}</span><b>${money(i.line_total)}</b></div>`).join("")}</div>${ss.map(s=>`<div style="margin-top:10px" class="mk28-muted">Pengiriman: <b>${esc(s.courier_company||"-")}</b> · ${esc(s.waybill_id||s.provider_tracking_id||"-")} · ${esc(s.status||"pending")} ${s.tracking_url?`<a href="${esc(s.tracking_url)}" target="_blank" rel="noopener" class="mk28-btn" style="display:inline-block;margin-left:5px">Lacak</a>`:""}</div>`).join("")}<div style="margin-top:10px"><span class="mk28-muted">${esc(o.shipping_recipient_name||"")} · ${esc(o.shipping_city||"")} ${esc(o.shipping_province||"")}</span></div></div>`}).join("")||'<div class="mk28-empty">Belum ada pesanan.</div>';
}
async function loadAddresses(){const el=document.getElementById("mk28-addresses"),sb=getSb(),u=getUser();if(!sb||!u)return;const q=await sb.from("buyer_addresses").select("*").eq("user_id",u.id).order("is_default",{ascending:false}).order("created_at",{ascending:false});if(q.error){el.innerHTML='<div class="mk28-empty">'+esc(q.error.message)+'</div>';return}
 el.innerHTML=`<div class="mk28-card"><strong>Tambah alamat</strong><form id="mk28-address-form" class="mk28-grid" style="margin-top:12px"><div class="mk28-field"><label>Label</label><input name="label" placeholder="Rumah"></div><div class="mk28-field"><label>Penerima</label><input name="recipient_name" required></div><div class="mk28-field"><label>No. HP</label><input name="phone" required></div><div class="mk28-field"><label>Kode Pos</label><input name="postal_code"></div><div class="mk28-field mk28-full"><label>Alamat lengkap</label><input name="address_line" required></div><div class="mk28-field"><label>Kota</label><input name="city"></div><div class="mk28-field"><label>Provinsi</label><input name="province"></div><div class="mk28-full"><button class="mk28-btn">Simpan Alamat</button></div></form></div>${(q.data||[]).map(a=>`<div class="mk28-card"><div class="mk28-row"><div><strong>${esc(a.label||"Alamat")}</strong> ${a.is_default?'<span class="mk28-pill">Utama</span>':""}<div style="margin-top:7px">${esc(a.recipient_name)} · ${esc(a.phone)}</div><div class="mk28-muted">${esc(a.address_line)}, ${esc(a.city)}, ${esc(a.province)} ${esc(a.postal_code)}</div></div><div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">${!a.is_default?`<button class="mk28-btn light" data-default="${a.id}">Jadikan Utama</button>`:""}<button class="mk28-btn danger" data-delete-address="${a.id}">Hapus</button></div></div></div>`).join("")||""}`;
 document.getElementById("mk28-address-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const data=Object.fromEntries(f);const ins=await sb.from("buyer_addresses").insert({...data,user_id:u.id,is_default:!(q.data||[]).length});if(ins.error)notice("Alamat",ins.error.message);else{await loadAddresses();notice("Alamat","Alamat berhasil disimpan.")}};
 el.querySelectorAll("[data-default]").forEach(b=>b.onclick=async()=>{const r=await sb.rpc("set_default_buyer_address",{p_address_id:b.dataset.default});if(r.error)notice("Alamat",r.error.message);else loadAddresses()});
 el.querySelectorAll("[data-delete-address]").forEach(b=>b.onclick=async()=>{if(!confirm("Hapus alamat ini?"))return;const r=await sb.from("buyer_addresses").delete().eq("id",b.dataset.deleteAddress).eq("user_id",u.id);if(r.error)notice("Alamat",r.error.message);else loadAddresses()});
}
async function loadWishlist(){const el=document.getElementById("mk28-wishlist"),sb=getSb(),u=getUser();if(!sb||!u)return;const q=await sb.from("wishlists").select("product_id,created_at,products(id,name,price,image_url,slug,store_id)").eq("user_id",u.id).order("created_at",{ascending:false});if(q.error){el.innerHTML='<div class="mk28-empty">'+esc(q.error.message)+'</div>';return}
 el.innerHTML=(q.data||[]).map(w=>{const p=w.products;return p?`<div class="mk28-card"><div class="mk28-row"><div style="display:flex;gap:10px"><img src="${esc(p.image_url||"")}" style="width:58px;height:72px;object-fit:cover;border-radius:8px;background:#eee"><div><strong>${esc(p.name)}</strong><div>${money(p.price)}</div></div></div><button class="mk28-btn danger" data-remove-wish="${p.id}">Hapus</button></div></div>`:""}).join("")||'<div class="mk28-empty">Belum ada produk favorit.</div>';
 el.querySelectorAll("[data-remove-wish]").forEach(b=>b.onclick=async()=>{const r=await sb.from("wishlists").delete().eq("user_id",u.id).eq("product_id",b.dataset.removeWish);if(r.error)notice("Favorit",r.error.message);else loadWishlist()});
}
async function loadReviews(){const el=document.getElementById("mk28-reviews"),sb=getSb(),u=getUser();if(!sb||!u)return;el.innerHTML='<div class="mk28-empty">Memuat item yang bisa diulas...</div>';
 const q=await sb.from("order_items").select("id,order_id,product_id,product_name,size,quantity").in("order_id",(await sb.from("orders").select("id").eq("buyer_id",u.id).in("status",["delivered","completed"])).data?.map(x=>x.id)||[]);if(q.error){el.innerHTML='<div class="mk28-empty">'+esc(q.error.message)+'</div>';return}
 const ids=(q.data||[]).map(x=>x.id);let existing=[];if(ids.length){const r=await sb.from("product_reviews").select("order_item_id,rating,review_text").in("order_item_id",ids).eq("buyer_id",u.id);if(!r.error)existing=r.data||[]}
 const done=new Set(existing.map(x=>x.order_item_id));
 el.innerHTML=(q.data||[]).filter(x=>!done.has(x.id)).map(i=>`<div class="mk28-card"><strong>${esc(i.product_name)}</strong><div class="mk28-muted">Pesanan ${esc(String(i.order_id).slice(0,8))}</div><div style="display:flex;gap:7px;margin-top:10px"><select id="mk28-rating-${i.id}" style="height:38px;border:1px solid #ddd8cf;border-radius:8px"><option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option></select><input id="mk28-review-${i.id}" placeholder="Tulis ulasan" maxlength="2000" style="flex:1;height:38px;border:1px solid #ddd8cf;border-radius:8px;padding:0 9px"><button class="mk28-btn" data-review="${i.id}">Kirim</button></div></div>`).join("")||'<div class="mk28-empty">Tidak ada item yang menunggu ulasan.</div>';
 el.querySelectorAll("[data-review]").forEach(b=>b.onclick=async()=>{const r=await sb.rpc("buyer_create_product_review",{p_order_item_id:b.dataset.review,p_rating:Number(document.getElementById("mk28-rating-"+b.dataset.review).value),p_comment:document.getElementById("mk28-review-"+b.dataset.review).value.trim()});if(r.error)notice("Ulasan",r.error.message);else{notice("Ulasan","Ulasan berhasil dikirim.");loadReviews()}});
}
async function loadNotifications(){const el=document.getElementById("mk28-notifications"),sb=getSb(),u=getUser();if(!sb||!u)return;const q=await sb.from("notifications").select("id,type,title,message,link,read_at,created_at").eq("user_id",u.id).order("created_at",{ascending:false}).limit(50);if(q.error){el.innerHTML='<div class="mk28-empty">'+esc(q.error.message)+'</div>';return}
 el.innerHTML=(q.data||[]).map(n=>`<div class="mk28-card" style="${n.read_at?"":"border-color:#171817"}"><div class="mk28-row"><div><strong>${esc(n.title||"Notifikasi")}</strong><div style="margin-top:5px">${esc(n.message||"")}</div><div class="mk28-muted" style="margin-top:6px">${new Date(n.created_at).toLocaleString("id-ID")}</div></div>${!n.read_at?`<button class="mk28-btn light" data-read="${n.id}">Tandai dibaca</button>`:""}</div></div>`).join("")||'<div class="mk28-empty">Belum ada notifikasi.</div>';
 el.querySelectorAll("[data-read]").forEach(b=>b.onclick=async()=>{const r=await sb.from("notifications").update({read_at:new Date().toISOString()}).eq("id",b.dataset.read).eq("user_id",u.id);if(r.error)notice("Notifikasi",r.error.message);else{loadNotifications();updateBadge()}});
}
async function updateBadge(){const sb=getSb(),u=getUser(),b=document.getElementById("mk28-account");if(!sb||!u||!b)return;const q=await sb.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",u.id).is("read_at",null);b.innerHTML="♙"+(q.count?`<span class="mk28-badge">${q.count>99?"99+":q.count}</span>`:"")}
async function loadTab(t){if(t==="home")loadHome();if(t==="orders")loadOrders();if(t==="addresses")loadAddresses();if(t==="wishlist")loadWishlist();if(t==="reviews")loadReviews();if(t==="notifications")loadNotifications()}
function boot(){ensureUI();addAccountButton();const u=getUser();if(u?.id&&u.id!==lastUserId){lastUserId=u.id;updateBadge()}setTimeout(()=>{addAccountButton();updateBadge()},1200)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
setTimeout(boot,2000);setTimeout(boot,5000);
window.marketKitaBuyerExperience={open,close,refresh};
})();