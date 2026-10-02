function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=900, s-maxage=900",...extraHeaders}});}
function clean(v){return String(v||"").trim();}
function supabaseHeaders(key){return {apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"};}
async function sb(url,key,path,options={}){
  const r=await fetch(url+path,{...options,headers:{...supabaseHeaders(key),...(options.headers||{})}});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={};}
  if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);
  return d;
}
function sourceId(rows,code){return Array.isArray(rows)?rows.find(x=>x.source_code===code)?.id:null;}
async function databaseStreetSearch(env,q,province,city,district,subdistrict,postal){
  const url=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""),key=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
  if(!url||!key)return [];
  const params=new URLSearchParams();
  params.set("p_query",q||"");if(province)params.set("p_province",province);if(city)params.set("p_city",city);
  if(district)params.set("p_district",district);if(subdistrict)params.set("p_subdistrict",subdistrict);if(postal)params.set("p_postal",postal);params.set("p_limit","20");
  return await sb(url,key,"/rest/v1/rpc/search_address_streets",{method:"POST",body:JSON.stringify(Object.fromEntries(params))});
}
async function cacheStreets(env,rows,sourceCode="BIG_RBI"){
  const url=String(env.SUPABASE_URL||"").trim().replace(/\/+$/,""),key=String(env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
  if(!url||!key||!rows.length)return;
  try{
    const src=await sb(url,key,"/rest/v1/address_street_sources?select=id,source_code&source_code=eq."+encodeURIComponent(sourceCode));
    const source_id=src?.[0]?.id||null;if(!source_id)return;
    const payload=rows.filter(x=>x?.street).map(x=>({
      source_id,source_record_id:x.road_id?String(x.road_id):null,street_name:x.street,
      province_name:x.province||null,city_name:x.city||null,district_name:x.district||null,
      subdistrict_name:x.subdistrict||null,postal_codes:x.postcode?[String(x.postcode)]:[],
      road_status:x.road_status!=null?String(x.road_status):null,road_owner:x.road_owner!=null?String(x.road_owner):null,
      source_status:x.source_status||null,source_updated_at:x.updated!=null?String(x.updated):null,
      is_authoritative:sourceCode==="BIG_RBI",latitude:x.lat??null,longitude:x.lon??null,metadata:{source:sourceCode}
    }));
    if(payload.length)await sb(url,key,"/rest/v1/address_streets?on_conflict=source_id,source_record_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(payload)});
  }catch(e){console.warn("MarketKita street cache:",e?.message||e);}
}
function addRow(map,row,source){
  const street=clean(row.street||row.road||row.name);
  if(!street)return;
  const postcode=clean(row.postcode);
  const key=(street+"|"+postcode).toLowerCase();
  if(map.has(key))return;
  map.set(key,{
    street,
    house_number:clean(row.house_number||row.housenumber),
    postcode,
    district:clean(row.district||row.suburb||row.locality),
    city:clean(row.city||row.town||row.municipality||row.county),
    province:clean(row.province||row.state),
    source:source||"reference",
    label:[street,row.house_number||row.housenumber,row.district||row.suburb||row.locality,row.city||row.town||row.municipality||row.county,row.province||row.state,postcode].filter(Boolean).join(", "),
    lat:row.lat??null,lon:row.lon??null
  });
}
async function searchPoint(q,city,province,district,headers){
  const n=new URL("https://nominatim.openstreetmap.org/search");
  n.searchParams.set("q",[q,district,city,province,"Indonesia"].filter(Boolean).join(", "));
  n.searchParams.set("countrycodes","id");n.searchParams.set("format","jsonv2");n.searchParams.set("limit","1");
  const r=await fetch(n.toString(),{headers}); if(!r.ok)return null;
  const d=await r.json().catch(()=>[]);
  return Array.isArray(d)&&d[0]?[Number(d[0].lon),Number(d[0].lat)]:null;
}
async function cityPoint(city,province,headers){
  return searchPoint("",city,province,"",headers);
}
async function queryBIG(map,q,city,province,district,headers){
  const point=q?await searchPoint(q,city,province,district,headers):await cityPoint(city,province,headers);
  const u=new URL("https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/863/query");
  const safeQ=q.toUpperCase().replace(/'/g,"''");
  // If the typed text is a housing complex, neighborhood, landmark, or
  // incomplete address rather than an official road name, locate that text
  // first and then return official BIG roads around that location.
  const where=q
    ? "UPPER(NAMRJL) LIKE '%"+safeQ+"%'"
    : "1=1";
  u.searchParams.set("where",where);
  u.searchParams.set("outFields","OBJECTID,NAMRJL,AUTRJL,STARJL,UPDATED");
  u.searchParams.set("returnGeometry","true");u.searchParams.set("f","json");
  u.searchParams.set("resultRecordCount","100");
  if(point){
    u.searchParams.set("geometry",JSON.stringify({x:point[0],y:point[1]}));
    u.searchParams.set("geometryType","esriGeometryPoint");u.searchParams.set("inSR","4326");
    u.searchParams.set("spatialRel","esriSpatialRelIntersects");
    u.searchParams.set("distance",q?"3000":"30000");u.searchParams.set("units","esriSRUnit_Meter");
  }
  const r=await fetch(u.toString(),{headers});if(!r.ok)return 0;
  const d=await r.json().catch(()=>({}));
  let count=0;
  for(const x of Array.isArray(d.features)?d.features:[]){
    const a=x?.attributes||{},g=x?.geometry||{};
    if(!clean(a.NAMRJL))continue;
    const xy=g.paths?.[0]?.[0]||[];
    addRow(map,{street:a.NAMRJL,city,district,province,lat:null,lon:null},"BIG-RBI");
    const key=clean(a.NAMRJL).toLowerCase();
    for(const [k,v] of map){
      if(k.startsWith(key+"|")){
        v.official=true;v.road_id=a.OBJECTID;v.road_status=a.STARJL??null;v.road_owner=a.AUTRJL??null;v.updated=a.UPDATED??null;break;
      }
    }
    count++;
  }
  // No exact road-name match: fetch nearby official roads and let the UI
  // show them as recommendations for the searched locality.
  if(q&&count===0&&point){
    u.searchParams.set("where","1=1");
    u.searchParams.set("distance","5000");
    const rr=await fetch(u.toString(),{headers});if(!rr.ok)return 0;
    const dd=await rr.json().catch(()=>({}));
    for(const x of Array.isArray(dd.features)?dd.features:[]){
      const a=x?.attributes||{};
      if(!clean(a.NAMRJL))continue;
      addRow(map,{street:a.NAMRJL,city,district,province},"BIG-RBI");
      const key=clean(a.NAMRJL).toLowerCase();
      for(const [k,v] of map)if(k.startsWith(key+"|")){v.official=true;v.nearby=true;v.road_id=a.OBJECTID;break;}
    }
  }
  return count;
}
async function queryNominatimAndPhoton(map,q,city,province,district,headers){
  const n=new URL("https://nominatim.openstreetmap.org/search");
  if(q)n.searchParams.set("street",q);
  n.searchParams.set("city",city);
  if(province)n.searchParams.set("state",province);
  n.searchParams.set("country","Indonesia");n.searchParams.set("countrycodes","id");
  n.searchParams.set("format","jsonv2");n.searchParams.set("addressdetails","1");n.searchParams.set("limit","20");
  const nr=await fetch(n.toString(),{headers});
  if(nr.ok){
    const nd=await nr.json().catch(()=>[]);
    for(const item of Array.isArray(nd)?nd:[]){
      const a=item?.address||{};
      addRow(map,{street:a.road||a.pedestrian||a.cycleway||item?.display_name?.split(",")?.[0],housenumber:a.house_number,postcode:a.postcode,district:a.suburb||a.village||a.town||a.city_district,city:a.city||a.town||a.municipality||a.county,province:a.state,lat:item.lat?Number(item.lat):null,lon:item.lon?Number(item.lon):null},"OSM");
    }
  }
  const p=new URL("https://photon.komoot.io/api/");
  p.searchParams.set("q",[q,district,city,province,"Indonesia"].filter(Boolean).join(", "));
  p.searchParams.set("countrycode","ID");p.searchParams.set("layer","street");p.searchParams.set("limit","20");
  const pr=await fetch(p.toString(),{headers});
  if(pr.ok){
    const pd=await pr.json().catch(()=>({features:[]}));
    for(const f of Array.isArray(pd.features)?pd.features:[]){
      const x=f?.properties||{};
      addRow(map,{street:x.street||x.name,housenumber:x.housenumber,postcode:x.postcode,district:x.district||x.locality,city:x.city||x.county,province:x.state,lat:f?.geometry?.coordinates?.[1],lon:f?.geometry?.coordinates?.[0]},"OSM");
    }
  }
}
export async function onRequestGet(context){
  const u=new URL(context.request.url);
  const q=clean(u.searchParams.get("q"));
  const city=clean(u.searchParams.get("city"));
  const province=clean(u.searchParams.get("province"));
  const district=clean(u.searchParams.get("district"));
  if(!city&&!province)return json({ok:true,data:[]});
  const headers={"Accept":"application/json","User-Agent":"MarketKita/1.0 address autocomplete"};
  const results=new Map();
  try{
    // Local master database is the first source. This makes autocomplete
    // independent from public geocoder latency once a city has been indexed.
    try{
      const dbRows=await databaseStreetSearch(context.env,q,province,city,district,"",u.searchParams.get("postal")||"");
      for(const x of Array.isArray(dbRows)?dbRows:[]){
        addRow(results,{street:x.street_name,province:x.province_name,city:x.city_name,district:x.district_name,subdistrict:x.subdistrict_name,postcode:(x.postal_codes||[])[0],lat:x.latitude,lon:x.longitude,road_id:x.id,road_status:x.road_status,road_owner:x.road_owner},x.is_authoritative?"BIG-RBI":"DB");
      }
    }catch(dbError){console.warn("MarketKita street DB:",dbError?.message||dbError);}
    await queryBIG(results,q,city,province,district,headers);
    if(results.size)await cacheStreets(context.env,[...results.values()].filter(x=>x.source==="BIG-RBI"),"BIG_RBI");
    // OSM remains a fallback/completion source for streets that are not
    // present in the current RBI road layer.
    if(results.size<20 || q) await queryNominatimAndPhoton(results,q,city,province,district,headers);
    let data=[...results.values()];
    const terms=q.toLowerCase().split(/\s+/).filter(Boolean);
    if(terms.length){
      data.sort((a,b)=>{
        const ao=a.official?1:0,bo=b.official?1:0;
        const aa=a.street.toLowerCase(),bb=b.street.toLowerCase();
        const am=terms.every(t=>aa.includes(t)),bm=terms.every(t=>bb.includes(t));
        return Number(bo)-Number(ao)||Number(bm)-Number(am)||aa.localeCompare(bb,"id");
      });
    }else{
      data.sort((a,b)=>Number(Boolean(b.official))-Number(Boolean(a.official))||a.street.localeCompare(b.street,"id"));
    }
    return json({ok:true,data:data.slice(0,20),source:"BIG RBI + OSM fallback"});
  }catch(e){
    return json({ok:false,error:"Pencarian nama jalan sedang tidak tersedia."},502);
  }
}
