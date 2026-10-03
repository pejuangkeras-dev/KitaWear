/* MarketKita P28 — Buyer Experience integrated into the existing Profil Akun. */
(function(){
"use strict";
const getSb=()=>window.marketKitaGetSupabase?.()||window.kwSupabase||null;
const getUser=()=>window.marketKitaGetCurrentUser?.()||window.kwCurrentUser||null;
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const money=v=>"Rp "+Number(v||0).toLocaleString("id-ID");
const notice=(title,msg)=>typeof window.showKwNotice==="function"?window.showKwNotice(msg,title):window.alert(title+"\n\n"+msg);
function styles(){
 if(document.getElementById("mk-p28-integrated-style"))return;
 const s=document.createElement("style");s.id="mk-p28-integrated-style";s.textContent=`
 .mk28-account-card{background:#fffdf9;border:1px solid #e4ded5;border-radius:16px;padding:16px;margin:10px 0}
 .mk28-account-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
 .mk28-account-muted{color:#77736c;font-size:11px;line-height:1.5}
 .mk28-account-btn{border:0;background:#171817;color:#fff;border-radius:9px;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer}
 .mk28-account-btn.light{background:#f0ede7;color:#222}
 .mk28-account-empty{padding:28px;text-align:center;color:#777;border:1px dashed #d9d3c9;border-radius:14px;background:#fffdf9}
 .mk28-review-item{border-top:1px solid #ece6dd;padding:14px 0}.mk28-review-item:first-child{border-top:0}
 .mk28-review-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
 .mk28-review-form select,.mk28-review-form input{height:38px;border:1px solid #ddd8cf;border-radius:9px;padding:0 9px;background:#fff}
 .mk28-review-form input{flex:1;min-width:180px}
 @media(max-width:620px){.mk28-review-form input{min-width:100%}}
 `;document.head.appendChild(s);
}
function activityGroup(){return [...document.querySelectorAll(".account-nav-group")].find(g=>/Aktivitas/i.test(g.querySelector(".account-nav-title")?.textContent||""))||null}
function addNav(section,label){
 if(document.querySelector('[data-account-section="'+section+'"]'))return;
 const g=activityGroup();if(!g)return;
 const b=document.createElement("button");b.type="button";b.className="account-nav-item";b.dataset.accountSection=section;b.textContent=label;g.appendChild(b);
}
function addSection(section,html){
 if(document.getElementById("accountSection-"+section))return;
 const main=document.querySelector(".account-main");if(!main)return;
 const el=document.createElement("div");el.id="accountSection-"+section;el.className="account-section";el.innerHTML=html;
 const anchor=document.getElementById("accountSection-coins")||document.getElementById("accountSection-disputes");
 if(anchor?.parentNode)anchor.parentNode.insertBefore(el,anchor);else main.appendChild(el);
}
function install(){
 styles();addNav("favorites","Favorit / Wishlist");addNav("reviews","Ulasan Produk");
 addSection("favorites",`<div class="account-page-head"><div><h3>Favorit / Wishlist</h3><p>Produk yang Anda simpan untuk dibeli nanti.</p></div><button type="button" class="orders-refresh" id="mk28-favorites-refresh">↻ Muat Ulang</button></div><div id="mk28-favorites-list"><div class="mk28-account-empty">Memuat favorit...</div></div>`);
 addSection("reviews",`<div class="account-page-head"><div><h3>Ulasan Produk</h3><p>Beri penilaian untuk produk dari pesanan yang sudah tiba.</p></div><button type="button" class="orders-refresh" id="mk28-reviews-refresh">↻ Muat Ulang</button></div><div id="mk28-reviews-list"><div class="mk28-account-empty">Memuat ulasan...</div></div>`);
 document.getElementById("mk28-favorites-refresh")?.addEventListener("click",loadFavorites);
 document.getElementById("mk28-reviews-refresh")?.addEventListener("click",loadReviews);
}
async function loadFavorites(){
 const el=document.getElementById("mk28-favorites-list"),sb=getSb(),u=getUser();if(!el||!sb||!u)return;
 const q=await sb.from("wishlists").select("product_id,created_at,products(id,name,price,image_url,slug,store_id)").eq("user_id",u.id).order("created_at",{ascending:false});
 if(q.error){el.innerHTML='<div class="mk28-account-empty">'+esc(q.error.message)+'</div>';return}
 const rows=(q.data||[]).filter(x=>x.products);
 if(!rows.length){el.innerHTML='<div class="mk28-account-empty">Belum ada produk favorit.</div>';return}
 el.innerHTML=rows.map(w=>{const p=w.products;return '<article class="mk28-account-card"><div class="mk28-account-row"><div style="display:flex;gap:12px;min-width:0"><img src="'+esc(p.image_url||"")+'" alt="'+esc(p.name)+'" style="width:64px;height:78px;object-fit:cover;border-radius:9px;background:#eee"><div><strong>'+esc(p.name)+'</strong><div style="margin-top:5px;font-weight:800">'+money(p.price)+'</div><div class="mk28-account-muted">Disimpan '+new Date(w.created_at).toLocaleDateString("id-ID")+'</div></div></div><button type="button" class="mk28-account-btn light" data-remove-favorite="'+esc(p.id)+'">Hapus</button></div></article>'}).join("");
 el.querySelectorAll("[data-remove-favorite]").forEach(btn=>btn.addEventListener("click",async()=>{const r=await sb.from("wishlists").delete().eq("user_id",u.id).eq("product_id",btn.dataset.removeFavorite);if(r.error)notice("Favorit",r.error.message);else{await loadFavorites();if(typeof window.updateWishlistCount==="function")window.updateWishlistCount()}}));
}
async function loadReviews(){
 const el=document.getElementById("mk28-reviews-list"),sb=getSb(),u=getUser();if(!el||!sb||!u)return;
 const orders=await sb.from("orders").select("id,order_number,status").eq("buyer_id",u.id).in("status",["delivered","completed"]);
 if(orders.error){el.innerHTML='<div class="mk28-account-empty">'+esc(orders.error.message)+'</div>';return}
 const orderIds=(orders.data||[]).map(x=>x.id);if(!orderIds.length){el.innerHTML='<div class="mk28-account-empty">Belum ada pesanan yang siap diulas.</div>';return}
 const items=await sb.from("order_items").select("id,order_id,product_id,product_name,size,quantity").in("order_id",orderIds);
 if(items.error){el.innerHTML='<div class="mk28-account-empty">'+esc(items.error.message)+'</div>';return}
 const ids=(items.data||[]).map(x=>x.id);let existing=[];
 if(ids.length){const r=await sb.from("product_reviews").select("order_item_id,rating,review_text").in("order_item_id",ids).eq("buyer_id",u.id);if(!r.error)existing=r.data||[]}
 const done=new Set(existing.map(x=>x.order_item_id)),pending=(items.data||[]).filter(x=>!done.has(x.id));
 if(!pending.length){el.innerHTML='<div class="mk28-account-empty">Semua produk dari pesanan selesai sudah Anda ulas.</div>';return}
 el.innerHTML=pending.map(i=>'<article class="mk28-review-item"><strong>'+esc(i.product_name)+'</strong><div class="mk28-account-muted">Pesanan '+esc(String(i.order_id).slice(0,8))+(i.size?" · Ukuran "+esc(i.size):"")+'</div><div class="mk28-review-form"><select id="mk28-rating-'+esc(i.id)+'"><option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option></select><input id="mk28-review-'+esc(i.id)+'" maxlength="2000" placeholder="Tulis pengalaman Anda"><button type="button" class="mk28-account-btn" data-review="'+esc(i.id)+'">Kirim Ulasan</button></div></article>').join("");
 el.querySelectorAll("[data-review]").forEach(btn=>btn.addEventListener("click",async()=>{const id=btn.dataset.review,rating=Number(document.getElementById("mk28-rating-"+id)?.value||5),comment=String(document.getElementById("mk28-review-"+id)?.value||"").trim();if(comment.length<3){notice("Ulasan","Tulis ulasan minimal 3 karakter.");return}btn.disabled=true;const r=await sb.rpc("buyer_create_product_review",{p_order_item_id:id,p_rating:rating,p_comment:comment});btn.disabled=false;if(r.error)notice("Ulasan",r.error.message);else{notice("Ulasan","Ulasan berhasil dikirim.");loadReviews()}}));
}
function wrap(){
 const original=window.showAccountSection;if(typeof original!=="function"||original.__mk28Wrapped)return;
 const wrapped=function(section){original(section);if(section==="favorites")loadFavorites();if(section==="reviews")loadReviews()};
 wrapped.__mk28Wrapped=true;window.showAccountSection=wrapped;
 document.querySelectorAll(".account-nav-item[data-account-section]").forEach(b=>{if(b.dataset.mk28Bound)return;b.dataset.mk28Bound="1";b.addEventListener("click",()=>wrapped(b.dataset.accountSection))});
}
function boot(){
 install();wrap();
 const accountButton=document.getElementById("accountButton");
 if(accountButton){accountButton.title="Profil Akun";accountButton.setAttribute("aria-label","Profil Akun")}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
setTimeout(boot,800);setTimeout(boot,2000);
window.marketKitaBuyerExperience={open:()=>window.openAccount?.(),close:()=>window.closeAccount?.(),refresh:()=>{loadFavorites();loadReviews()}};
})();