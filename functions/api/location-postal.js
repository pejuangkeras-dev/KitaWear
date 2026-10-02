function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=3600"}});}
function rajaKey(env){return String(env.RAJAONGKIR_API_KEY||"").trim();}
export async function onRequestGet(context){
  try{
    const key=rajaKey(context.env); if(!key)return json({error:"RAJAONGKIR_API_KEY belum dipasang di Cloudflare."},500);
    const q=String(context.request.url||"").split("?")[1]||"";
    const params=new URLSearchParams(q);
    const search=String(params.get("search")||"").trim();
    if(search.length<2)return json({error:"Parameter search minimal 2 karakter."},400);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    let r;
    try{
      r=await fetch("https://rajaongkir.komerce.id/api/v1/destination/domestic-destination?search="+encodeURIComponent(search)+"&limit=50&offset=0",{headers:{key},signal:controller.signal});
    }finally{clearTimeout(timer);}
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.meta?.status!=="success")return json({error:d?.meta?.message||"Gagal mengambil kode pos RajaOngkir."},502);
    return json({ok:true,data:Array.isArray(d.data)?d.data:[]});
  }catch(e){return json({error:e?.name==="AbortError"?"RajaOngkir timeout.":(e?.message||"Gagal mengambil kode pos.")},502);}
}
