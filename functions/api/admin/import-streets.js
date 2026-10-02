function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function clean(v){return String(v??"").trim();}
function headers(key){return {apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"};}
async function sb(url,key,path,options={}){const r=await fetch(url+path,{...options,headers:{...headers(key),...(options.headers||{})}});const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok)throw new Error(d?.message||d?.error||d?.details||`Supabase HTTP ${r.status}`);return d;}
function authorized(request,env){const token=clean(env.STREET_IMPORT_TOKEN)||clean(env.SUPABASE_SERVICE_ROLE_KEY);const h=clean(request.headers.get("authorization"));return token&&h===`Bearer ${token}`;}
export async function onRequestPost(context){
 try{
  if(!authorized(context.request,context.env))return json({error:"Unauthorized"},401);
  const env=context.env,url=clean(env.SUPABASE_URL).replace(/\/+$/,""),key=clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if(!url||!key)return json({error:"Supabase server configuration incomplete"},500);
  const body=await context.request.json().catch(()=>({}));
  const offset=Math.max(0,Number(body.offset||0)); const batchSize=Math.min(1000,Math.max(100,Number(body.batch_size||1000)));
  const api="https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/863/query";
  const q=new URL(api);q.searchParams.set("where","NAMRJL IS NOT NULL AND NAMRJL <> ''");q.searchParams.set("outFields","OBJECTID,NAMRJL,AUTRJL,STARJL,FGSRJL,REMARK");q.searchParams.set("returnGeometry","true");q.searchParams.set("outSR","4326");q.searchParams.set("resultOffset",String(offset));q.searchParams.set("resultRecordCount",String(batchSize));q.searchParams.set("f","json");
  const r=await fetch(q.toString(),{headers:{"Accept":"application/json","User-Agent":"MarketKita-StreetImporter/1.0"}});const d=await r.json().catch(()=>({}));
  if(!r.ok||d.error)return json({error:d?.error?.message||`BIG HTTP ${r.status}`},502);
  const features=Array.isArray(d.features)?d.features:[];const source=await sb(url,key,"/rest/v1/address_street_sources?select=id&source_code=eq.BIG_RBI");
  const sourceId=source?.[0]?.id;if(!sourceId)return json({error:"BIG_RBI source missing"},500);
  const rows=features.map(f=>{const a=f.attributes||{},g=f.geometry||{};let x=null,y=null;if(Array.isArray(g.paths)&&g.paths[0]?.length){const pts=g.paths.flat().filter(p=>Array.isArray(p)&&p.length>=2);if(pts.length){x=pts.reduce((s,p)=>s+Number(p[0]),0)/pts.length;y=pts.reduce((s,p)=>s+Number(p[1]),0)/pts.length;}}return{source_id:sourceId,source_record_id:String(a.OBJECTID),street_name:clean(a.NAMRJL),road_status:a.STARJL==null?null:String(a.STARJL),road_owner:a.AUTRJL==null?null:String(a.AUTRJL),road_class:a.FGSRJL==null?null:String(a.FGSRJL),source_status:"BIG_RBI",is_authoritative:true,latitude:y,longitude:x,metadata:{remark:a.REMARK??null}};}).filter(x=>x.street_name);
  if(rows.length)await sb(url,key,"/rest/v1/address_streets?on_conflict=source_id,source_record_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
  const next=features.length===batchSize?offset+features.length:null;
  return json({ok:true,source:"BIG_RBI",offset,imported:rows.length,next_offset:next,done:next===null,has_more:next!==null});
 }catch(e){return json({error:e?.message||"Import failed"},500);}
}