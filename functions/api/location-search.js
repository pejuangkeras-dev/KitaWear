function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
export async function onRequestGet(context){
  const key=String(context.env.RAJAONGKIR_API_KEY||"").trim();
  const q=String(new URL(context.request.url).searchParams.get("search")||"").trim();
  if(!key)return json({error:"RAJAONGKIR_API_KEY belum dipasang di Cloudflare."},500);
  if(q.length<2)return json({ok:true,data:[]});
  try{
    const r=await fetch("https://rajaongkir.komerce.id/api/v1/destination/domestic-destination?search="+encodeURIComponent(q)+"&limit=20&offset=0",{headers:{key}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.meta?.status!=="success")return json({ok:true,data:[]});
    return json({ok:true,data:Array.isArray(d.data)?d.data:[]});
  }catch(e){return json({error:e?.message||"Gagal mencari lokasi."},502);}
}
