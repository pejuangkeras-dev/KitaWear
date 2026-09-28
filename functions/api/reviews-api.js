function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
    }
  })
}

function baseUrl(v){
  return String(v||"").trim().replace(/\/+$/,"")
}

function sbHeaders(key,token){
  return {
    apikey:key,
    Authorization:`Bearer ${token||key}`,
    "Content-Type":"application/json"
  }
}

async function sbFetch(url,key,path,opts={}){
  const r=await fetch(`${url}${path}`,{
    ...opts,
    headers:{
      ...sbHeaders(key,opts.token),
      ...(opts.headers||{})
    }
  })

  const text=await r.text()
  let data=null

  try{
    data=text?JSON.parse(text):null
  }catch{
    data={raw:text}
  }

  if(!r.ok){
    throw new Error(
      data?.message||
      data?.details||
      data?.hint||
      data?.error||
      `Supabase HTTP ${r.status}`
    )
  }

  return data
}

async function getUser(url,anon,token){
  const r=await fetch(`${url}/auth/v1/user`,{
    headers:{
      apikey:anon,
      Authorization:`Bearer ${token}`
    }
  })

  if(!r.ok)return null
  return await r.json()
}

export async function onRequestGet({request,env}){
  try{
    const url=baseUrl(env.SUPABASE_URL)
    const key=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim()

    if(!url||!key){
      return json({
        error:"Konfigurasi Supabase server belum lengkap."
      },500)
    }

    const q=new URL(request.url).searchParams

    const type=q.get("type")||"seller"
    const storeId=q.get("store_id")||""
    const productId=q.get("product_id")||""
    const productName=q.get("product_name")||""

    if(type==="seller"&&!storeId){
      return json({
        reviews:[],
        summary:{rating:0,count:0}
      })
    }

    let path=""

    if(type==="product"){
      if(!productId&&!productName){
        return json({
          reviews:[],
          summary:{rating:0,count:0}
        })
      }

      const filters=[]

      if(productId){
        filters.push(
          `product_id=eq.${encodeURIComponent(productId)}`
        )
      }

      if(productName){
        filters.push(
          `product_name=eq.${encodeURIComponent(productName)}`
        )
      }

      path=
        `/rest/v1/product_reviews`+
        `?select=id,rating,comment,reviewer_name,created_at,product_id,product_name`+
        `&${filters.join("&")}`+
        `&order=created_at.desc&limit=100`

    }else{

      path=
        `/rest/v1/seller_reviews`+
        `?select=id,rating,comment,reviewer_name,created_at,store_id`+
        `&store_id=eq.${encodeURIComponent(storeId)}`+
        `&order=created_at.desc&limit=100`
    }

    const reviews=await sbFetch(url,key,path)

    const rows=Array.isArray(reviews)?reviews:[]

    const rating=rows.length
      ? rows.reduce(
          (a,x)=>a+Number(x.rating||0),
          0
        )/rows.length
      : 0

    return json({
      reviews:rows,
      summary:{
        rating:Number(rating.toFixed(1)),
        count:rows.length
      }
    })

  }catch(e){

    return json({
      reviews:[],
      summary:{rating:0,count:0},
      error:e.message||"Gagal mengambil ulasan."
    },200)
  }
}

export async function onRequestPost({request,env}){
  try{

    const url=baseUrl(env.SUPABASE_URL)

    const anon=String(
      env.SUPABASE_ANON_KEY||""
    ).trim()

    const key=String(
      env.SUPABASE_SERVICE_ROLE_KEY||""
    ).trim()

    const auth=String(
      request.headers.get("Authorization")||""
    )

    const token=auth
      .replace(/^Bearer\s+/i,"")
      .trim()

    if(!url||!anon||!key){
      return json({
        error:"Konfigurasi Supabase server belum lengkap."
      },500)
    }

    if(!token){
      return json({
        error:"Silakan login terlebih dahulu untuk memberi ulasan."
      },401)
    }

    const user=await getUser(
      url,
      anon,
      token
    )

    if(!user?.id||!user.email){
      return json({
        error:"Sesi login tidak valid."
      },401)
    }

    const body=await request.json()

    const type=
      body?.type==="product"
      ? "product"
      : "seller"

    const storeId=
      String(body?.store_id||"").trim()

    const productId=
      String(body?.product_id||"").trim()

    const productName=
      String(body?.product_name||"").trim()

    const rating=Number(body?.rating)

    const comment=
      String(body?.comment||"").trim()

    if(
      !storeId||
      !Number.isInteger(rating)||
      rating<1||
      rating>5||
      comment.length<3||
      comment.length>1000
    ){
      return json({
        error:"Rating atau ulasan belum valid."
      },400)
    }

    const orders=await sbFetch(
      url,
      key,
      `/rest/v1/orders`+
      `?select=id,status,customer_email`+
      `&customer_email=eq.${encodeURIComponent(user.email)}`+
      `&status=in.(delivered,completed)`+
      `&limit=100`
    )

    const orderIds=
      (Array.isArray(orders)?orders:[])
      .map(x=>x.id)
      .filter(Boolean)

    if(!orderIds.length){
      return json({
        error:"Ulasan hanya tersedia setelah pesanan selesai."
      },403)
    }

    const items=await sbFetch(
      url,
      key,
      `/rest/v1/order_items`+
      `?select=id,order_id,store_id,product_name`+
      `&store_id=eq.${encodeURIComponent(storeId)}`+
      `&order_id=in.(${orderIds.join(",")})`+
      `&limit=500`
    )

    const matches=
      (Array.isArray(items)?items:[])
      .filter(
        x =>
          type==="seller" ||
          (
            productName &&
            x.product_name===productName
          )
      )

    if(!matches.length){
      return json({
        error:
          "Akun ini belum memiliki pesanan selesai untuk seller/produk tersebut."
      },403)
    }

    const orderId=matches[0].order_id

    const table=
      type==="product"
      ? "product_reviews"
      : "seller_reviews"

    const existingPath=
      type==="product"
      ?
        `/rest/v1/product_reviews`+
        `?select=id`+
        `&reviewer_id=eq.${encodeURIComponent(user.id)}`+
        `&product_name=eq.${encodeURIComponent(productName)}`+
        `&order_id=eq.${encodeURIComponent(orderId)}`+
        `&limit=1`
      :
        `/rest/v1/seller_reviews`+
        `?select=id`+
        `&reviewer_id=eq.${encodeURIComponent(user.id)}`+
        `&store_id=eq.${encodeURIComponent(storeId)}`+
        `&order_id=eq.${encodeURIComponent(orderId)}`+
        `&limit=1`

    const existing=
      await sbFetch(
        url,
        key,
        existingPath
      )

    if(
      Array.isArray(existing)&&
      existing.length
    ){
      return json({
        error:"Anda sudah memberi ulasan untuk pesanan ini."
      },409)
    }

    const row={
      reviewer_id:user.id,
      reviewer_name:
        String(
          user.user_metadata?.full_name||
          user.email.split("@")[0]||
          "Pembeli"
        ),
      order_id:orderId,
      store_id:storeId,
      rating,
      comment
    }

    if(type==="product"){
      row.product_id=productId||null
      row.product_name=productName||""
    }

    await sbFetch(
      url,
      key,
      `/rest/v1/${table}`,
      {
        method:"POST",
        headers:{
          Prefer:"return=minimal"
        },
        body:JSON.stringify(row)
      }
    )

    return json({ok:true})

  }catch(e){

    return json({
      error:e.message||"Gagal menyimpan ulasan."
    },500)
  }
}
