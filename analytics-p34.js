(()=>{
  const KEY="marketkita_analytics_session_v1";
  let sid=localStorage.getItem(KEY);
  if(!sid){sid=crypto.randomUUID();localStorage.setItem(KEY,sid);}
  const queue=[];
  let flushing=false;
  function currentAuth(){try{return window.marketKitaGetSupabase?.()?.auth?.getSession?.()}catch{return null}}
  async function send(e){
    queue.push(e); if(flushing)return; flushing=true;
    try{
      while(queue.length){
        const item=queue.shift();
        let token=null;
        try{const s=await currentAuth();token=s?.data?.session?.access_token||null;}catch{}
        const r=await fetch("/api/analytics",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify({
          event_id:crypto.randomUUID(),event_name:item.name,session_id:sid,
          product_id:item.product_id||null,store_id:item.store_id||null,voucher_id:item.voucher_id||null,
          path:location.pathname+location.search,referrer:document.referrer||null,metadata:item.metadata||{}
        })});
        if(!r.ok)break;
      }
    }catch{}finally{flushing=false;}
  }
  window.marketKitaTrack=(name,data={})=>send({name,...data});
  function wrap(name,cb){
    const fn=window[name]; if(typeof fn!=="function"||fn.__p34)return;
    const wrapped=function(...args){
      try{cb(...args)}catch{}
      return fn.apply(this,args);
    };
    wrapped.__p34=true; window[name]=wrapped;
  }
  document.addEventListener("DOMContentLoaded",()=>{
    window.marketKitaTrack("page_view");
    setTimeout(()=>{
      wrap("openProductDetail",(i)=>{
        const p=window.products?.[i]||window.marketKitaProducts?.[i];
        if(p)window.marketKitaTrack("product_view",{product_id:p.id,store_id:p.store_id,metadata:{name:String(p.name||"").slice(0,120)}});
      });
      wrap("add",(i)=>{
        const p=window.products?.[i]||window.marketKitaProducts?.[i];
        if(p)window.marketKitaTrack("add_to_cart",{product_id:p.id,store_id:p.store_id});
      });
      wrap("addFromProductCard",(i)=>{
        const p=window.products?.[i]||window.marketKitaProducts?.[i];
        if(p)window.marketKitaTrack("add_to_cart",{product_id:p.id,store_id:p.store_id});
      });
      wrap("openCheckout",()=>window.marketKitaTrack("checkout_started"));
    },600);
  });
})();