function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"public, max-age=900, s-maxage=900"
    }
  });
}
function clean(v){return String(v||"").trim();}
function key(v){return clean(v).toLowerCase().replace(/^kabupaten\s+/,"").replace(/^kota\s+/,"").replace(/[^a-z0-9]/g,"");}
function norm(row){
  const province=clean(row.province_name||row.province||row.state);
  const city=clean(row.city_name||row.city||row.regency_name||row.regency);
  const district=clean(row.district_name||row.district||row.kecamatan);
  const subdistrict=clean(row.subdistrict_name||row.subdistrict||row.village||row.kelurahan);
  const zip=clean(row.zip_code||row.postal_code||row.postcode);
  return {
    id:row.id||row.destination_id||null,
    province_id:row.province_id||null,
    province_name:province,
    city_id:row.city_id||row.regency_id||null,
    city_name:city,
    district_id:row.district_id||null,
    district_name:district,
    subdistrict_id:row.subdistrict_id||row.village_id||null,
    subdistrict_name:subdistrict,
    zip_code:zip,
    label:[subdistrict,district,city,province,zip].filter(Boolean).join(" · ")
  };
}
async function fetchJson(url){
  const r=await fetch(url,{cf:{cacheTtl:3600,cacheEverything:true}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error("HTTP "+r.status);
  return Array.isArray(d?.data)?d.data:[];
}
function provinceRows(rows,q){
  const nq=key(q);
  return rows
    .filter(p=>key(p?.name).includes(nq)||nq.includes(key(p?.name)))
    .map(p=>norm({id:String(p.id),province_id:String(p.id),province_name:p.name}))
    .map(x=>({...x,label:x.province_name}));
}
async function searchOsm(q){
  try{
    const u=new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q",q+", Indonesia");
    u.searchParams.set("format","jsonv2");
    u.searchParams.set("addressdetails","1");
    u.searchParams.set("countrycodes","id");
    u.searchParams.set("limit","40");
    // Do NOT restrict to layer=address. Province, city, district and village
    // are administrative features and were previously filtered out here.
    const r=await fetch(u.toString(),{
      headers:{
        "Accept":"application/json",
        "User-Agent":"MarketKita/1.0 location autocomplete"
      }
    });
    const d=await r.json().catch(()=>[]);
    return (Array.isArray(d)?d:[]).map(x=>{
      const a=x?.address||{};
      return norm({
        id:"osm:"+String(x.place_id||""),
        province_name:a.state,
        city_name:a.city||a.town||a.municipality||a.county,
        district_name:a.city_district||a.district||a.suburb,
        subdistrict_name:a.village||a.suburb||a.neighbourhood,
        zip_code:a.postcode
      });
    }).filter(x=>x.province_name&&(x.city_name||x.district_name||x.subdistrict_name));
  }catch{return []}
}
export async function onRequestGet(context){
  const u=new URL(context.request.url);
  const q=clean(u.searchParams.get("search"));
  if(q.length<2)return json({ok:true,data:[]});

  const cacheKey=new Request("https://marketkita.invalid/location-search/v3/"+encodeURIComponent(q.toLowerCase()));
  try{
    const cached=await caches.default.match(cacheKey);
    if(cached)return cached;
  }catch{}

  try{
    // Primary source: EMSIFA static regional dataset. It has the complete
    // Indonesian administrative hierarchy and does not consume RajaOngkir HITs.
    const provinces=await fetchJson("https://www.emsifa.com/api-wilayah-indonesia/v2/provinces.json");
    const pRows=provinceRows(provinces,q);
    const resultMap=new Map();

    for(const x of pRows){
      resultMap.set("p|"+key(x.province_name),x);
    }

    // Search kabupaten/kota across all provinces. Requests are batched so
    // typing a city name remains responsive without hammering the source.
    const nq=key(q);
    const cityResults=[];
    for(let i=0;i<provinces.length;i+=8){
      const batch=provinces.slice(i,i+8);
      const groups=await Promise.all(batch.map(async p=>{
        try{
          const cities=await fetchJson("https://www.emsifa.com/api-wilayah-indonesia/v2/regencies/"+encodeURIComponent(p.id)+".json");
          return cities
            .filter(c=>key(c?.name).includes(nq)||nq.includes(key(c?.name)))
            .map(c=>norm({
              id:String(c.id),
              city_id:String(c.id),
              city_name:c.name,
              province_id:String(p.id),
              province_name:p.name
            }));
        }catch{return []}
      }));
      cityResults.push(...groups.flat());
      if(cityResults.length>=60)break;
    }

    for(const x of cityResults){
      resultMap.set("c|"+key(x.city_name)+"|"+key(x.province_name),x);
    }

    // If the query is a district/village/street-like name, use an
    // administrative-aware geocoder as a secondary source. This is only for
    // search suggestions; RajaOngkir is never called here.
    if(resultMap.size<1 || !pRows.length){
      const osmRows=await searchOsm(q);
      for(const x of osmRows){
        const kx=[x.subdistrict_name,x.district_name,x.city_name,x.province_name,x.zip_code].map(key).join("|");
        if(kx&&!resultMap.has("o|"+kx))resultMap.set("o|"+kx,x);
      }
    }

    const data=[...resultMap.values()]
      .sort((a,b)=>{
        const score=x=>{
          const vals=[x.province_name,x.city_name,x.district_name,x.subdistrict_name,x.zip_code]
            .filter(Boolean).map(key);
          return vals.reduce((s,v)=>s+(v===nq?100:v.startsWith(nq)?80:v.includes(nq)?60:nq.includes(v)&&v.length>3?30:0),0);
        };
        return score(b)-score(a);
      })
      .slice(0,80);

    const response=new Response(JSON.stringify({ok:true,data,source:"EMSIFA administrative data + OSM fallback"}),{
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "Cache-Control":"public, max-age=3600, s-maxage=3600"
      }
    });
    try{await caches.default.put(cacheKey,response.clone());}catch{}
    return response;
  }catch(e){
    return json({ok:false,error:"Gagal mencari data wilayah. Silakan coba lagi."},502);
  }
}
