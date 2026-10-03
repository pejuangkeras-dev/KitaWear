(function(){
"use strict";
let followBusy=false;
function client(){try{return window.marketKitaGetSupabase?.()||null}catch{return null}}
function user(){try{return window.marketKitaGetCurrentUser?.()||null}catch{return null}}
function currentStore(){
  try{
    const p=window.products?.[Number(window.productDetailIndex)];
    return p?.store||null;
  }catch{return null}
}
async function refreshFollowButton(){
  const button=document.getElementById("mkFollowStore"),store=currentStore(),sb=client(),u=user();
  if(!button||!store?.id)return;
  if(!u){button.textContent="♡ Ikuti Toko";button.dataset.following="0";button.disabled=false;return}
  const q=await sb.from("store_follows").select("store_id").eq("user_id",u.id).eq("store_id",store.id).maybeSingle();
  if(q.error){button.textContent="♡ Ikuti Toko";return}
  button.textContent=q.data?"♥ Diikuti":"♡ Ikuti Toko";
  button.dataset.following=q.data?"1":"0";
}
async function toggleStoreFollow(){
  const sb=client(),u=user(),store=currentStore();
  if(!sb||!store?.id)return;
  if(!u){window.marketKitaOpenAccountFallback?.();return}
  if(followBusy)return;
  followBusy=true;
  const b=document.getElementById("mkFollowStore");if(b)b.disabled=true;
  try{
    const following=b?.dataset.following==="1";
    const q=following
      ? await sb.from("store_follows").delete().eq("user_id",u.id).eq("store_id",store.id)
      : await sb.from("store_follows").upsert({user_id:u.id,store_id:store.id},{onConflict:"user_id,store_id"});
    if(q.error)throw q.error;
    await refreshFollowButton();
  }catch(e){window.showKwNotice?.(e.message||"Gagal memperbarui ikuti toko.","Ikuti Toko")}
  finally{followBusy=false;const x=document.getElementById("mkFollowStore");if(x)x.disabled=false}
}
function injectFollowButton(){
  const actions=document.querySelector(".seller-actions");
  if(!actions||document.getElementById("mkFollowStore"))return;
  const b=document.createElement("button");
  b.id="mkFollowStore";b.type="button";b.textContent="♡ Ikuti Toko";
  b.addEventListener("click",e=>{e.stopPropagation();toggleStoreFollow()});
  actions.appendChild(b);
  refreshFollowButton();
}
function boot(){
  injectFollowButton();
  const obs=new MutationObserver(()=>injectFollowButton());
  obs.observe(document.body,{childList:true,subtree:true});
  setTimeout(injectFollowButton,500);
  setTimeout(injectFollowButton,1500);
}
window.toggleStoreFollow=toggleStoreFollow;
window.refreshMarketKitaFollow=refreshFollowButton;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();