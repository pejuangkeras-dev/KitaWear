function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=900, s-maxage=900",...extraHeaders}});}
function clean(v){return String(v||"").trim();}
function addRow(map,row){
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
    label:[street,row.house_number||row.housenumber,row.district||row.suburb||row.locality,row.city||row.town||row.municipality||row.county,row.province||row.state,postcode].filter(Boolean).join(", "),
    lat:row.lat??null,lon:row.lon??null
  });
}
export async function onRequestGet(context){
  const u=new URL(context.request.url);
  const q=clean(u.searchParams.get("q"));
  const city=clean(u.searchParams.get("city"));
  const province=clean(u.searchParams.get("province"));
  const district=clean(u.searchParams.get("district"));
  if(!city&&!province)return json({ok:true,data:[]});
  const results=new Map();
  const headers={"Accept":"application/json","User-Agent":"MarketKita/1.0 address autocomplete"};
  try{
    // Nominatim structured street search is better for a real street name:
    // it separates street/city/state instead of asking the geocoder to guess
    // the whole free-form query. Nominatim documents street/city/state/country
    // as structured search fields.
    const n=new URL("https://nominatim.openstreetmap.org/search");
    if(q)n.searchParams.set("street",q);
    n.searchParams.set("city",city);
    if(province)n.searchParams.set("state",province);
    n.searchParams.set("country","Indonesia");
    n.searchParams.set("countrycodes","id");
    n.searchParams.set("format","jsonv2");
    n.searchParams.set("addressdetails","1");
    n.searchParams.set("layer","address");
    n.searchParams.set("limit","20");
    const nr=await fetch(n.toString(),{headers});
    if(nr.ok){
      const nd=await nr.json().catch(()=>[]);
      for(const item of Array.isArray(nd)?nd:[]){
        const a=item?.address||{};
        addRow(results,{
          street:a.road||a.pedestrian||a.cycleway||item?.display_name?.split(",")?.[0],
          housenumber:a.house_number,
          postcode:a.postcode,
          district:a.suburb||a.village||a.town||a.city_district,
          city:a.city||a.town||a.municipality||a.county,
          province:a.state,
          lat:item.lat?Number(item.lat):null,lon:item.lon?Number(item.lon):null
        });
      }
    }

    // Photon is retained as a second source because it is designed for
    // search-as-you-type and can return street objects that Nominatim misses.
    const p=new URL("https://photon.komoot.io/api/");
    p.searchParams.set("q",[q,district,city,province,"Indonesia"].filter(Boolean).join(", "));
    p.searchParams.set("countrycode","ID");
    p.searchParams.set("layer","street");
    p.searchParams.set("limit","20");
    p.searchParams.set("lang","default");
    const pr=await fetch(p.toString(),{headers});
    if(pr.ok){
      const pd=await pr.json().catch(()=>({features:[]}));
      for(const f of Array.isArray(pd.features)?pd.features:[]){
        const x=f?.properties||{};
        addRow(results,{
          street:x.street||x.name,
          housenumber:x.housenumber,
          postcode:x.postcode,
          district:x.district||x.locality,
          city:x.city||x.county,
          province:x.state,
          lat:f?.geometry?.coordinates?.[1],lon:f?.geometry?.coordinates?.[0]
        });
      }
    }

    let data=[...results.values()];
    // If the user typed text, prefer street names containing the typed words.
    const terms=q.toLowerCase().split(/\s+/).filter(Boolean);
    if(terms.length){
      data.sort((a,b)=>{
        const aa=a.street.toLowerCase(),bb=b.street.toLowerCase();
        const am=terms.every(t=>aa.includes(t)),bm=terms.every(t=>bb.includes(t));
        return Number(bm)-Number(am)||aa.localeCompare(bb);
      });
    }else{
      data.sort((a,b)=>a.street.localeCompare(b.street,"id"));
    }
    return json({ok:true,data:data.slice(0,20)});
  }catch(e){
    return json({ok:false,error:"Pencarian nama jalan sedang tidak tersedia."},502);
  }
}
