function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=3600"}});}
export async function onRequestGet(context){
  const key=String(context.env.RAJAONGKIR_API_KEY||"").trim(), id=String(context.params?.district_id||"").trim();
  if(!key)return json({error:"RAJAONGKIR_API_KEY belum dipasang di Cloudflare."},500);
  if(!/^\d+$/.test(id))return json({error:"ID kecamatan tidak valid."},400);
  try{
    const r=await fetch("https://rajaongkir.komerce.id/api/v1/destination/sub-district/"+encodeURIComponent(id),{headers:{key}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.meta?.status!=="success")return json({error:d?.meta?.message||"Gagal mengambil kelurahan/kode pos."},502);
    return json({ok:true,data:Array.isArray(d.data)?d.data:[]});
  }catch(e){return json({error:e?.message||"Gagal mengambil kelurahan/kode pos."},502);}
}
