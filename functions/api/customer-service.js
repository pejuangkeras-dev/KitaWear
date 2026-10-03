const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const base=v=>String(v||"").trim().replace(/\/+$/,"");
async function authUser(request,url,anon){
  const h=request.headers.get("Authorization")||"";
  if(!/^Bearer\s+/i.test(h))return null;
  const token=h.replace(/^Bearer\s+/i,"").trim();
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:"Bearer "+token}});
  return r.ok?r.json():null;
}
async function rest(url,key,path,options={}){
  const r=await fetch(url+path,{...options,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(options.headers||{})}});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d={raw:t}};
  if(!r.ok)throw new Error(d?.message||d?.details||d?.hint||d?.error||`Supabase HTTP ${r.status}`);
  return d;
}
async function context(request,env){
  const url=base(env.SUPABASE_URL),service=String(env.SUPABASE_SERVICE_ROLE_KEY||""),anon=String(env.SUPABASE_ANON_KEY||"");
  if(!url||!service||!anon)throw new Error("Konfigurasi Supabase server belum lengkap.");
  const user=await authUser(request,url,anon);if(!user?.id)return {error:"Login diperlukan.",status:401};
  const p=await rest(url,service,`/rest/v1/profiles?select=id,full_name,phone,role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
  const profile=p?.[0]||null;
  return {url,service,user,profile,isAdmin:profile?.role==="admin"};
}
function inFilter(ids){return "("+ids.map(x=>encodeURIComponent(String(x))).join(",")+")";}
async function hydrateThreads(a,threads){
  const rows=Array.isArray(threads)?threads:[];
  const ids=[...new Set(rows.map(x=>x.customer_id).filter(Boolean))];
  const admins=[...new Set(rows.map(x=>x.assigned_admin_id).filter(Boolean))];
  const all=[...new Set([...ids,...admins])];
  const profiles=all.length?await rest(a.url,a.service,`/rest/v1/profiles?select=id,full_name,phone,role&id=in.${inFilter(all)}&limit=500`):[];
  const pm=new Map((profiles||[]).map(x=>[String(x.id),x]));
  return rows.map(t=>({...t,customer:pm.get(String(t.customer_id))||null,assigned_admin:pm.get(String(t.assigned_admin_id))||null}));
}
async function listMessages(a,threadIds,limit=500){
  if(!threadIds.length)return [];
  return await rest(a.url,a.service,`/rest/v1/cs_messages?select=id,thread_id,sender_id,sender_role,body,created_at,read_at&thread_id=in.${inFilter(threadIds)}&order=created_at.desc&limit=${limit}`);
}
export async function onRequestGet({request,env}){
  try{
    const a=await context(request,env);if(a.error)return json({error:a.error},a.status);
    const q=new URL(request.url).searchParams,threadId=String(q.get("thread_id")||"").trim();
    let threads=[];
    if(a.isAdmin){
      const status=String(q.get("status")||"").trim();
      let path="/rest/v1/cs_threads?select=id,customer_id,assigned_admin_id,subject,status,created_at,updated_at,last_message_at&order=last_message_at.desc&limit=100";
      if(status&&["open","pending","resolved"].includes(status))path+="&status=eq."+encodeURIComponent(status);
      if(threadId)path+="&id=eq."+encodeURIComponent(threadId);
      threads=await rest(a.url,a.service,path);
    }else{
      let path="/rest/v1/cs_threads?select=id,customer_id,assigned_admin_id,subject,status,created_at,updated_at,last_message_at&customer_id=eq."+encodeURIComponent(a.user.id)+"&order=last_message_at.desc&limit=20";
      if(threadId)path+="&id=eq."+encodeURIComponent(threadId);
      threads=await rest(a.url,a.service,path);
    }
    const hydrated=await hydrateThreads(a,threads);
    const ids=hydrated.map(x=>x.id);
    const messages=await listMessages(a,ids,threadId?1000:300);
    if(threadId&&!hydrated.length)return json({error:"Percakapan tidak ditemukan."},404);
    return json({threads:hydrated,messages:Array.isArray(messages)?messages:[],is_admin:a.isAdmin,user:{id:a.user.id,full_name:a.profile?.full_name||a.user.email||"Customer",role:a.profile?.role||"buyer"}});
  }catch(e){return json({error:e.message||"Gagal memuat Customer Service."},500)}
}
export async function onRequestPost({request,env}){
  try{
    const a=await context(request,env);if(a.error)return json({error:a.error},a.status);
    const b=await request.json().catch(()=>({})),body=String(b.body||"").trim(),threadId=String(b.thread_id||"").trim(),subject=String(b.subject||"Bantuan Customer Service").trim().slice(0,160);
    if(!body)return json({error:"Pesan tidak boleh kosong."},400);
    if(body.length>4000)return json({error:"Pesan maksimal 4000 karakter."},400);
    let tid=threadId;
    if(a.isAdmin){
      if(!tid)return json({error:"thread_id wajib untuk balasan admin."},400);
      const check=await rest(a.url,a.service,`/rest/v1/cs_threads?select=id,customer_id,status&id=eq.${encodeURIComponent(tid)}&limit=1`);
      if(!check?.length)return json({error:"Percakapan tidak ditemukan."},404);
    }else if(tid){
      const check=await rest(a.url,a.service,`/rest/v1/cs_threads?select=id,customer_id,status&id=eq.${encodeURIComponent(tid)}&customer_id=eq.${encodeURIComponent(a.user.id)}&limit=1`);
      if(!check?.length)return json({error:"Percakapan tidak ditemukan."},404);
      if(check[0].status==="resolved"){
        await rest(a.url,a.service,`/rest/v1/cs_threads?id=eq.${encodeURIComponent(tid)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"open"})});
      }
    }else{
      const existing=await rest(a.url,a.service,`/rest/v1/cs_threads?select=id,status&customer_id=eq.${encodeURIComponent(a.user.id)}&status=neq.resolved&order=last_message_at.desc&limit=1`);
      if(existing?.[0])tid=existing[0].id;
      else{
        const created=await rest(a.url,a.service,"/rest/v1/cs_threads?select=id",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({customer_id:a.user.id,subject,status:"open"})});
        tid=created?.[0]?.id;if(!tid)throw new Error("Gagal membuat percakapan Customer Service.");
      }
    }
    const inserted=await rest(a.url,a.service,"/rest/v1/cs_messages?select=id,thread_id,sender_id,sender_role,body,created_at,read_at",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({thread_id:tid,sender_id:a.user.id,sender_role:a.isAdmin?"admin":"customer",body})});
    if(!a.isAdmin){
      await rest(a.url,a.service,`/rest/v1/cs_threads?id=eq.${encodeURIComponent(tid)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"open",last_message_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    }
    return json({ok:true,thread_id:tid,message:inserted?.[0]||null});
  }catch(e){return json({error:e.message||"Pesan gagal dikirim."},500)}
}
export async function onRequestPatch({request,env}){
  try{
    const a=await context(request,env);if(a.error)return json({error:a.error},a.status);
    const b=await request.json().catch(()=>({})),tid=String(b.thread_id||"").trim(),action=String(b.action||"").trim();
    if(!tid)return json({error:"thread_id wajib diisi."},400);
    const rows=await rest(a.url,a.service,`/rest/v1/cs_threads?select=id,customer_id,status&id=eq.${encodeURIComponent(tid)}&limit=1`);
    const thread=rows?.[0];if(!thread)return json({error:"Percakapan tidak ditemukan."},404);
    if(!a.isAdmin&&String(thread.customer_id)!==String(a.user.id))return json({error:"Akses ditolak."},403);
    if(action==="read"){
      const senderRole=a.isAdmin?"customer":"admin";
      await rest(a.url,a.service,`/rest/v1/cs_messages?thread_id=eq.${encodeURIComponent(tid)}&sender_role=eq.${senderRole}&read_at=is.null`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({read_at:new Date().toISOString()})});
      return json({ok:true});
    }
    if(!a.isAdmin)return json({error:"Akses ditolak."},403);
    if(action==="status"){
      const status=String(b.status||"").trim();if(!["open","pending","resolved"].includes(status))return json({error:"Status tidak valid."},400);
      await rest(a.url,a.service,`/rest/v1/cs_threads?id=eq.${encodeURIComponent(tid)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status,assigned_admin_id:a.user.id,updated_at:new Date().toISOString()})});
      return json({ok:true});
    }
    if(action==="assign"){
      await rest(a.url,a.service,`/rest/v1/cs_threads?id=eq.${encodeURIComponent(tid)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({assigned_admin_id:a.user.id,updated_at:new Date().toISOString()})});
      return json({ok:true});
    }
    return json({error:"Action tidak dikenal."},400);
  }catch(e){return json({error:e.message||"Operasi Customer Service gagal."},500)}
}