function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=300, s-maxage=300"}});}
function clean(v){return String(v||"").trim();}
function norm(row){
  const province=clean(row.province_name||row.province||row.state);
  const city=clean(row.city_name||row.city||row.regency_name||row.regency);
  const district=clean(row.district_name||row.district||row.kecamatan);
  const subdistrict=clean(row.subdistrict_name||row.subdistrict||row.village||row.kelurahan);
  const zip=clean(row.zip_code||row.postal_code||row.postcode);
  return {
    id:row.id||row.destination_id||null,
    province_id:row.province_id||null,province_name:province,
    city_id:row.city_id||row.regency_id||null,city_name:city,
    district_id:row.district_id||null,district_name:district,
    subdistrict_id:row.subdistrict_id||row.village_id||null,subdistrict_name:subdistrict,
    zip_code:zip,
    label:[subdistrict,district,city,province,zip].filter(Boolean).join(" · ")
  };
}
async function raja(env,q){
  const key=String(env.RAJAONGKIR_API_KEY||"").trim();
  if(!key)return [];
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const r=await fetch("https://rajaongkir.komerce.id/api/v1/destination/domestic-destination?search="+encodeURIComponent(q)+"&limit=50&offset=0",{headers:{key},signal:controller.signal});
    const d=await r.json().catch(()=>({}));
    return r.ok&&d?.meta?.status==="success"&&Array.isArray(d.data)?d.data:[];
  }catch{return []}finally{clearTimeout(timer);}
}
async function osm(q){
  try{
    const u=new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q",q+", Indonesia");u.searchParams.set("format","jsonv2");u.searchParams.set("addressdetails","1");u.searchParams.set("countrycodes","id");u.searchParams.set("limit","40");u.searchParams.set("layer","address");
    const r=await fetch(u.toString(),{headers:{"Accept":"application/json","User-Agent":"MarketKita/1.0 location autocomplete"}});
    const d=await r.json().catch(()=>[]);
    return (Array.isArray(d)?d:[]).map(x=>{
      const a=x?.address||{};
      return norm({province:a.state,city:a.city||a.town||a.municipality||a.county,district:a.district||a.city_district||a.suburb,subdistrict:a.village||a.suburb||a.neighbourhood,postcode:a.postcode, id:"osm:"+String(x.place_id||"")});
    }).filter(x=>x.province_name&&(x.city_name||x.district_name||x.subdistrict_name));
  }catch{return []}
}
export async function onRequestGet(context){
  const q=clean(new URL(context.request.url).searchParams.get("search"));
  if(q.length<2)return json({ok:true,data:[]});
  try{
    const [rRows,oRows]=await Promise.all([raja(context.env,q),osm(q)]);
    const map=new Map();
    for(const raw of [...rRows,...oRows]){
      const x=norm(raw);const key=[x.subdistrict_name,x.district_name,x.city_name,x.province_name,x.zip_code].join("|").toLowerCase();
      if(!key||map.has(key))continue;
      map.set(key,x);
    }
    const data=[...map.values()].sort((a,b)=>{
      const qn=q.toLowerCase().replace(/[^a-z0-9]/g,"");
      const score=x=>{
        const vals=[x.subdistrict_name,x.district_name,x.city_name,x.province_name].map(v=>String(v||"").toLowerCase().replace(/[^a-z0-9]/g,""));
        return vals.reduce((s,v)=>s+(v===qn?100:v.includes(qn)?60:qn.includes(v)&&v.length>3?35:0),0)+(x.zip_code?2:0);
      };
      return score(b)-score(a);
    }).slice(0,50);
    return json({ok:true,data});
  }catch(e){return json({ok:false,error:e?.message||"Gagal mencari lokasi."},502);}
}
