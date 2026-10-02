function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=86400"}});}
export async function onRequestGet(){
  try{
    const r=await fetch("https://www.emsifa.com/api-wilayah-indonesia/v2/provinces.json",{cf:{cacheTtl:86400,cacheEverything:true}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json({error:"Gagal mengambil daftar provinsi."},502);
    return json({ok:true,data:Array.isArray(d.data)?d.data:[]});
  }catch(e){return json({error:e?.message||"Gagal mengambil provinsi."},502);}
}
