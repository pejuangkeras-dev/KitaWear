const ROUTES={
  "/api/search-products":{limit:60,window:60,label:"search"},
  "/api/public-products":{limit:120,window:60,label:"catalog"},
  "/api/location-search":{limit:30,window:60,label:"location"},
  "/api/address-suggestions":{limit:30,window:60,label:"address"},
  "/api/shipping-quote":{limit:20,window:60,label:"shipping"},
  "/api/create-transaction":{limit:10,window:60,label:"checkout"},
  "/api/analytics":{limit:120,window:60,label:"analytics"}
};

function routeConfig(path){
  const p=String(path||"").replace(/\/+$/,"")||"/";
  return ROUTES[p]||null;
}

async function sha256(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function identity(request){
  const auth=String(request.headers.get("Authorization")||"").trim();
  if(auth)return "auth:"+auth;
  const ip=String(request.headers.get("CF-Connecting-IP")||"").trim();
  if(ip)return "ip:"+ip;
  return "anonymous";
}

async function checkLimit(request,config){
  const cache=globalThis.caches?.default;
  if(!cache)return {allowed:true,remaining:config.limit,resetAt:Date.now()+config.window*1000};
  const rawKey=await sha256("p33|"+config.label+"|"+identity(request));
  const key=new Request("https://marketkita.invalid/__p33_rate_limit/"+rawKey,{method:"GET"});
  const now=Date.now();
  let state=null;
  try{
    const hit=await cache.match(key);
    if(hit){
      state=await hit.json().catch(()=>null);
      if(state?.resetAt && state.resetAt<=now)state=null;
    }
  }catch{}
  const next=state?{count:Number(state.count||0)+1,resetAt:Number(state.resetAt)}:{count:1,resetAt:now+config.window*1000};
  const remaining=Math.max(0,config.limit-next.count);
  if(next.count>config.limit){
    return {allowed:false,remaining:0,resetAt:next.resetAt};
  }
  try{
    await cache.put(key,new Response(JSON.stringify(next),{
      headers:{"Content-Type":"application/json","Cache-Control":"max-age="+config.window}
    }));
  }catch{}
  return {allowed:true,remaining,resetAt:next.resetAt};
}

export async function onRequest(context){
  const request=context.request;
  if(request.method==="OPTIONS")return context.next();
  const config=routeConfig(new URL(request.url).pathname);
  if(!config)return context.next();
  try{
    const result=await checkLimit(request,config);
    if(!result.allowed){
      const retry=Math.max(1,Math.ceil((result.resetAt-Date.now())/1000));
      return new Response(JSON.stringify({
        error:"RATE_LIMITED",
        message:"Terlalu banyak permintaan. Silakan coba lagi beberapa saat."
      }),{
        status:429,
        headers:{
          "Content-Type":"application/json; charset=utf-8",
          "Cache-Control":"no-store",
          "Retry-After":String(retry),
          "X-RateLimit-Limit":String(config.limit),
          "X-RateLimit-Remaining":"0",
          "X-RateLimit-Reset":String(Math.ceil(result.resetAt/1000))
        }
      });
    }
    const response=await context.next();
    response.headers.set("X-RateLimit-Limit",String(config.limit));
    response.headers.set("X-RateLimit-Remaining",String(result.remaining));
    response.headers.set("X-RateLimit-Reset",String(Math.ceil(result.resetAt/1000)));
    response.headers.set("X-MarketKita-RateLimit",config.label);
    return response;
  }catch(error){
    console.warn("MarketKita P33 rate limit:",error?.message||error);
    return context.next();
  }
}
