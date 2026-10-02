function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=86400"}});}
export async function onRequestGet(context){
  const id=String(context.params?.cityId||"").trim();
  if(!id)return json({error:"City ID wajib diisi."},400);
  try{
    const r=await fetch("https://www.emsifa.com/api-wilayah-indonesia/v2/districts/"+encodeURIComponent(id)+".json",{cf:{cacheTtl:86400,cacheEverything:true}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json({error:"Gagal mengambil kecamatan."},502);
    return json({ok:true,data:Array.isArray(d.data)?d.data:[]});
  }catch(e){return json({error:e?.message||"Gagal mengambil kecamatan."},502);}
}