function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
    }
  })
}
function baseUrl(v){return String(v||"").trim().replace(/\/+$/,"")}
function headers(key,token){return {apikey:key,Authorization:`Bearer ${token||key}`,"Content-Type":"application/json"}}
async function fetchSb(url,key,path,opts={}){
  const r=await fetch(url+path,{...opts,headers:{...headers(key,opts.token),...(opts.headers||{})}})
  const text=await r.text()
  let data=null
  try{data=text?JSON.parse(text):null}catch{data={raw:text}}
  if(!r.ok)throw new Error(data?.message||data?.details||data?.hint||data?.error||`Supabase HTTP ${r.status}`)
  return data
}
async function getUser(url,anon,token){
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:`Bearer ${token}`}})
  return r.ok?await r.json():null
}
async function rpcAsUser(url,anon,token,name,args){
  return fetchSb(url,anon,"/rest/v1/rpc/"+name,{method:"POST",token,body:JSON.stringify(args)})
}

export async function onRequestGet({request,env}){
  try{
    const url=baseUrl(env.SUPABASE_URL)
    const service=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim()
    const anon=String(env.SUPABASE_ANON_KEY||"").trim()
    if(!url||!service||!anon)return json({error:"Konfigurasi Supabase server belum lengkap."},500)

    const q=new URL(request.url).searchParams
    const type=q.get("type")==="seller"?"seller":"product"
    const storeId=String(q.get("store_id")||"").trim()
    const productId=String(q.get("product_id")||"").trim()

    if(type==="seller"&&!storeId)
      return json({reviews:[],summary:{rating:0,count:0},canReview:false})

    let path="/rest/v1/product_reviews?select=id,order_id,order_item_id,product_id,buyer_id,store_id,rating,review_text,seller_reply,seller_replied_at,created_at&order=created_at.desc&limit=100"
    if(type==="product"&&productId)path+="&product_id=eq."+encodeURIComponent(productId)
    if(type==="seller"&&storeId)path+="&store_id=eq."+encodeURIComponent(storeId)

    const raw=await fetchSb(url,service,path)
    const reviews=Array.isArray(raw)?raw:[]
    const buyerIds=[...new Set(reviews.map(x=>x.buyer_id).filter(Boolean))]
    let names=new Map()
    if(buyerIds.length){
      const profiles=await fetchSb(
        url,service,
        "/rest/v1/profiles?select=id,full_name&id=in.("+buyerIds.join(",")+")"
      )
      names=new Map((Array.isArray(profiles)?profiles:[]).map(x=>[String(x.id),x.full_name]))
    }

    const decorated=reviews.map(x=>({
      ...x,
      reviewer_name:names.get(String(x.buyer_id))||"Pembeli",
      comment:x.review_text||""
    }))
    const rating=decorated.length
      ? decorated.reduce((a,x)=>a+Number(x.rating||0),0)/decorated.length
      : 0

    let canReview=false
    const auth=String(request.headers.get("Authorization")||"")
    const token=auth.replace(/^Bearer\s+/i,"").trim()
    if(token&&storeId){
      const user=await getUser(url,anon,token)
      if(user?.id){
        const orders=await fetchSb(
          url,service,
          "/rest/v1/orders?select=id&buyer_id=eq."+encodeURIComponent(user.id)+
          "&status=eq.completed&payment_status=eq.paid&limit=100"
        )
        const ids=(Array.isArray(orders)?orders:[]).map(x=>x.id).filter(Boolean)
        if(ids.length){
          let itemPath="/rest/v1/order_items?select=id,order_id,product_id,store_id"+
            "&store_id=eq."+encodeURIComponent(storeId)+
            "&order_id=in.("+ids.join(",")+")"
          if(productId)itemPath+="&product_id=eq."+encodeURIComponent(productId)
          const items=await fetchSb(url,service,itemPath)
          const itemIds=(Array.isArray(items)?items:[]).map(x=>x.id).filter(Boolean)
          if(itemIds.length){
            const existing=await fetchSb(
              url,service,
              "/rest/v1/product_reviews?select=order_item_id,buyer_id"+
              "&buyer_id=eq."+encodeURIComponent(user.id)+
              "&order_item_id=in.("+itemIds.join(",")+")"
            )
            const reviewed=new Set(
              (Array.isArray(existing)?existing:[]).map(x=>String(x.order_item_id))
            )
            canReview=itemIds.some(id=>!reviewed.has(String(id)))
          }
        }
      }
    }

    return json({
      reviews:decorated,
      summary:{rating:Number(rating.toFixed(1)),count:decorated.length},
      canReview
    })
  }catch(e){
    return json({
      reviews:[],
      summary:{rating:0,count:0},
      canReview:false,
      error:e.message||"Gagal mengambil ulasan."
    },200)
  }
}

export async function onRequestPost({request,env}){
  try{
    const url=baseUrl(env.SUPABASE_URL)
    const anon=String(env.SUPABASE_ANON_KEY||"").trim()
    if(!url||!anon)return json({error:"Konfigurasi Supabase server belum lengkap."},500)

    const token=String(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim()
    if(!token)return json({error:"Silakan login terlebih dahulu untuk memberi ulasan."},401)

    const user=await getUser(url,anon,token)
    if(!user?.id)return json({error:"Sesi login tidak valid."},401)

    const body=await request.json()
    const productId=String(body?.product_id||"").trim()
    const storeId=String(body?.store_id||"").trim()
    const rating=Number(body?.rating)
    const comment=String(body?.comment||"").trim()

    if(!productId||!storeId||!Number.isInteger(rating)||rating<1||rating>5||comment.length<3||comment.length>2000)
      return json({error:"Rating atau ulasan belum valid."},400)

    const rows=await fetchSb(
      url,String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim(),
      "/rest/v1/order_items?select=id,order_id,product_id,store_id"+
      "&buyer_id=eq."+encodeURIComponent(user.id)+
      "&product_id=eq."+encodeURIComponent(productId)+
      "&store_id=eq."+encodeURIComponent(storeId)+
      "&limit=100"
    )
    const items=Array.isArray(rows)?rows:[]
    const completedIds=[]
    if(items.length){
      const orderIds=[...new Set(items.map(x=>x.order_id).filter(Boolean))]
      const orders=await fetchSb(
        url,String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim(),
        "/rest/v1/orders?select=id,status,payment_status&buyer_id=eq."+encodeURIComponent(user.id)+
        "&status=eq.completed&payment_status=eq.paid"+
        "&id=in.("+orderIds.join(",")+")"
      )
      const eligibleOrders=new Set((Array.isArray(orders)?orders:[]).map(x=>String(x.id)))
      for(const item of items){
        if(eligibleOrders.has(String(item.order_id)))completedIds.push(item.id)
      }
    }

    const item=items.find(x=>completedIds.includes(x.id))
    if(!item)return json({error:"Belum ada item pesanan selesai yang sesuai untuk diberi ulasan."},403)

    const result=await rpcAsUser(
      url,anon,token,"submit_product_review",
      {p_order_item_id:item.id,p_rating:rating,p_review_text:comment}
    )
    return json({ok:true,result})
  }catch(e){
    const msg=e.message||"Gagal menyimpan ulasan."
    const status=msg.includes("sudah direview")?409:500
    return json({error:msg},status)
  }
}
