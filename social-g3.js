(()=>{"use strict";
const sb=()=>window.marketKitaGetSupabase?.()||null, me=()=>window.marketKitaGetCurrentUser?.()||null;
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
async function loadG3Wishlist(){
 const root=document.getElementById("g3WishlistList"),u=me(),db=sb(); if(!root)return;
 if(!u||!db){root.innerHTML='<div class="account-empty">Silakan masuk untuk melihat wishlist.</div>';return}
 root.innerHTML='<div class="account-empty">Memuat wishlist...</div>';
 const q=await db.from("wishlists").select("product_id,created_at").eq("user_id",u.id).order("created_at",{ascending:false});
 if(q.error){root.innerHTML='<div class="account-empty">Wishlist belum dapat dimuat.</div>';return}
 const ids=(q.data||[]).map(x=>String(x.product_id));
 const rows=(window.marketKitaProducts||[]).filter(p=>ids.includes(String(p.id)));
 if(!rows.length){root.innerHTML='<div class="account-empty">Belum ada produk di wishlist. Gunakan ♡ pada produk yang Anda sukai.</div>';return}
 root.innerHTML='<div class="g3-wishlist-grid">'+rows.map(p=>{const i=(window.marketKitaProducts||[]).findIndex(x=>String(x.id)===String(p.id));return '<article class="g3-wishlist-card" onclick="openProductDetail('+i+')"><img src="'+esc(p.img||"")+'" alt="'+esc(p.name)+'" loading="lazy"><div><strong>'+esc(p.name)+'</strong><span>'+new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(p.price||0))+'</span><button type="button" onclick="event.stopPropagation();toggleWishlist('+i+',event)">♥ Hapus</button></div></article>'}).join("")+'</div>';
}
async function loadG3Follows(){
 const root=document.getElementById("g3FollowedStoresList"),u=me(),db=sb(); if(!root)return;
 if(!u||!db){root.innerHTML='<div class="account-empty">Silakan masuk untuk melihat toko yang diikuti.</div>';return}
 root.innerHTML='<div class="account-empty">Memuat toko...</div>';
 const q=await db.from("store_follows").select("store_id,created_at,stores(id,name,slug,status)").eq("user_id",u.id).order("created_at",{ascending:false});
 if(q.error){root.innerHTML='<div class="account-empty">Daftar toko belum dapat dimuat.</div>';return}
 const rows=(q.data||[]).filter(x=>x.stores?.status==="active"||!x.stores?.status);
 if(!rows.length){root.innerHTML='<div class="account-empty">Belum ada toko yang diikuti.</div>';return}
 root.innerHTML='<div class="g3-follow-list">'+rows.map(x=>{const s=x.stores;return '<div class="g3-follow-row"><div class="g3-follow-avatar">'+esc(String(s?.name||"T").trim().charAt(0).toUpperCase())+'</div><div><strong>'+esc(s?.name||"Toko MarketKita")+'</strong><small>@'+esc(s?.slug||"marketkita")+'</small></div><a href="/store.html?slug='+encodeURIComponent(s?.slug||"")+'">Kunjungi Toko</a><button type="button" onclick="g3UnfollowStore(\''+esc(x.store_id)+'\')">Berhenti Ikuti</button></div>'}).join("")+'</div>';
}
window.g3UnfollowStore=async id=>{const u=me(),db=sb();if(!u||!db)return;const q=await db.from("store_follows").delete().eq("user_id",u.id).eq("store_id",id);if(q.error){window.showKwNotice?.(q.error.message||"Gagal berhenti mengikuti toko.","Ikuti Toko");return}await loadG3Follows();window.refreshMarketKitaFollow?.();};
window.loadG3Social=async()=>{await loadG3Wishlist();await loadG3Follows();};
const originalShow=window.showAccountSection;
window.showAccountSection=function(section){if(typeof originalShow==="function")originalShow(section);if(section==="wishlist"||section==="follows")setTimeout(()=>{section==="wishlist"?loadG3Wishlist():loadG3Follows()},0);};
document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.loadG3Social?.(),900));
})();