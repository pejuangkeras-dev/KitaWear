function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=3600, s-maxage=3600",...extraHeaders}});}
export async function onRequestGet(context){
  const u=new URL(context.request.url);
  const q=String(u.searchParams.get("q")||"").trim();
  const city=String(u.searchParams.get("city")||"").trim();
  const province=String(u.searchParams.get("province")||"").trim();
  const district=String(u.searchParams.get("district")||"").trim();
  if(q.length<3)return json({ok:true,data:[]});
  const parts=[q,district,city,province,"Indonesia"].filter(Boolean);
  const target=new URL("https://photon.komoot.io/api/");
  target.searchParams.set("q",parts.join(", "));
  target.searchParams.set("countrycode","ID");
  target.searchParams.set("layer","street");
  target.searchParams.set("limit","8");
  target.searchParams.set("lang","default");
  try{
    const r=await fetch(target.toString(),{headers:{"Accept":"application/json","User-Agent":"MarketKita/1.0 address autocomplete"}});
    const d=await r.json().catch(()=>({features:[]}));
    if(!r.ok)return json({ok:false,error:"Pencarian nama jalan sedang tidak tersedia."},502);
    const seen=new Set(),data=[];
    for(const f of Array.isArray(d.features)?d.features:[]){
      const p=f?.properties||{};
      const street=String(p.street||p.name||"").trim();
      if(!street)continue;
      const key=(street+"|"+String(p.postcode||"")).toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      data.push({
        street,
        house_number:String(p.housenumber||"").trim(),
        postcode:String(p.postcode||"").trim(),
        district:String(p.district||p.locality||"").trim(),
        city:String(p.city||p.county||"").trim(),
        province:String(p.state||"").trim(),
        label:String([street,p.housenumber,p.district||p.locality,p.city||p.county,p.state,p.postcode].filter(Boolean).join(", ")),
        lat:f?.geometry?.coordinates?.[1]||null,
        lon:f?.geometry?.coordinates?.[0]||null
      });
      if(data.length>=8)break;
    }
    return json({ok:true,data});
  }catch(e){return json({ok:false,error:e?.message||"Gagal mencari nama jalan."},502);}
}
