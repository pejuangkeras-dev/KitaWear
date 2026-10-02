function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=900, s-maxage=900",...extraHeaders}});}
function clean(v){return String(v||"").trim();}
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
async function cityPoint(city,province,headers){
  const n=new URL("https://nominatim.openstreetmap.org/search");
  n.searchParams.set("q",[city,province,"Indonesia"].filter(Boolean).join(", "));
  n.searchParams.set("countrycodes","id");n.searchParams.set("format","jsonv2");n.searchParams.set("limit","1");
  const r=await fetch(n.toString(),{headers});
  if(!r.ok)return null;
  const d=await r.json().catch(()=>[]);
  return Array.isArray(d)&&d[0]?[Number(d[0].lon),Number(d[0].lat)]:null;
}
async function queryBIG(map,q,city,province,headers){
  // BIG's RBI road layer exposes NAMRJL (Nama Segmen Jalan). It is the
  // authoritative geospatial source used here instead of treating OSM as
  // the official street-name master.
  const point=await cityPoint(city,province,headers);
  const u=new URL("https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/791/query");
  const where=q
    ? "UPPER(NAMRJL) LIKE '%"+q.toUpperCase().replace(/'/g,"''")+"%'"
    : "1=1";
  u.searchParams.set("where",where);
  u.searchParams.set("outFields","OBJECTID,NAMRJL,AUTRJL,STARJL,UPDATED");
  u.searchParams.set("returnGeometry","true");
  u.searchParams.set("f","json");
  u.searchParams.set("resultRecordCount","100");
  if(point){
    u.searchParams.set("geometry",JSON.stringify({x:point[0],y:point[1]}));
    u.searchParams.set("geometryType","esriGeometryPoint");
    u.searchParams.set("inSR","4326");
    u.searchParams.set("spatialRel","esriSpatialRelIntersects");
    u.searchParams.set("distance","30000");
    u.searchParams.set("units","esriSRUnit_Meter");
  }
  const r=await fetch(u.toString(),{headers});
  if(!r.ok)return;
  const d=await r.json().catch(()=>({}));
  for(const x of Array.isArray(d.features)?d.features:[]){
    const a=x?.attributes||{};
    const g=x?.geometry||{};
    const xy=g.paths?.[0]?.[0]||[];
    addRow(map,{street:a.NAMRJL,city,district:"",province,lat:null,lon:null}, "BIG-RBI");
    // Preserve the official BIG road name and metadata in a lightweight
    // field without exposing the entire geometry to the browser.
    const key=clean(a.NAMRJL).toLowerCase();
    for(const [k,v] of map){if(k.startsWith(key+"|")){v.official=true;v.road_id=a.OBJECTID;v.road_status=a.STARJL??null;v.road_owner=a.AUTRJL??null;v.updated=a.UPDATED??null;break;}}
  }
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
    await queryBIG(results,q,city,province,headers);
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
