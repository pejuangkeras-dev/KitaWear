/* MarketKita — Supabase Auth route guard for Cloudflare Pages */
(function () {
  'use strict';

  const configPromise = fetch('/api/public-config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  }).then(async (response) => {
    const config = await response.json().catch(() => ({}));
    if (!response.ok || config.error) {
      throw new Error(config.error || 'Konfigurasi Supabase tidak tersedia.');
    }
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Konfigurasi Supabase belum lengkap.');
    }
    return config;
  });

const MARKETKITA_COOKIE_PREFIX="mk_auth_";
const MARKETKITA_COOKIE_CHUNK=3600;
function marketKitaEncode(value){
  const bytes=new TextEncoder().encode(String(value)); let binary="";
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function marketKitaDecode(value){
  try{
    const base64=String(value).replace(/-/g,"+").replace(/_/g,"/");
    const padded=base64+"=".repeat((4-base64.length%4)%4);
    const binary=atob(padded);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }catch(_){return null;}
}
function marketKitaCookieName(key,index){return MARKETKITA_COOKIE_PREFIX+marketKitaEncode(key)+"_"+index;}
function marketKitaSetCookie(name,value,maxAge){document.cookie=name+"="+value+"; Max-Age="+maxAge+"; Path=/; SameSite=Lax; Secure";}
function marketKitaReadCookies(key){
  const prefix=MARKETKITA_COOKIE_PREFIX+marketKitaEncode(key)+"_"; const parts=[];
  for(const part of document.cookie.split(";")){
    const trimmed=part.trim(); if(!trimmed.startsWith(prefix)) continue;
    const eq=trimmed.indexOf("="); if(eq<0) continue;
    const index=Number(trimmed.slice(prefix.length,eq)); if(Number.isInteger(index)) parts[index]=trimmed.slice(eq+1);
  }
  return parts.length?marketKitaDecode(parts.join("")):null;
}
function marketKitaClearCookies(key){
  const prefix=MARKETKITA_COOKIE_PREFIX+marketKitaEncode(key)+"_";
  for(const part of document.cookie.split(";")){
    const trimmed=part.trim(); if(!trimmed.startsWith(prefix)) continue;
    const eq=trimmed.indexOf("="); const name=eq>=0?trimmed.slice(0,eq):trimmed;
    document.cookie=name+"=; Max-Age=0; Path=/; SameSite=Lax; Secure";
  }
}
const marketKitaCookieStorage={
  getItem(key){return marketKitaReadCookies(key);},
  setItem(key,value){
    marketKitaClearCookies(key); const encoded=marketKitaEncode(value);
    const count=Math.max(1,Math.ceil(encoded.length/MARKETKITA_COOKIE_CHUNK));
    for(let i=0;i<count;i++) marketKitaSetCookie(marketKitaCookieName(key,i),encoded.slice(i*MARKETKITA_COOKIE_CHUNK,(i+1)*MARKETKITA_COOKIE_CHUNK),60*60*24*365);
  },
  removeItem(key){marketKitaClearCookies(key);}
};

  let clientPromise;
  function getClient() {
    if (!clientPromise) {
      clientPromise = configPromise.then((config) => {
        if (!window.supabase?.createClient) {
          throw new Error('Supabase JS belum dimuat.');
        }
        return window.supabase.createClient(
          config.supabaseUrl,
          config.supabaseAnonKey,
          {
            auth: {
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: true,
              storage: marketKitaCookieStorage
            }
          }
        );
      });
    }
    return clientPromise;
  }

  async function requireRole(allowedRoles, options = {}) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const loginUrl = options.loginUrl || '/?account=login';
    const client = await getClient();

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      location.replace(loginUrl);
      throw new Error('LOGIN_REQUIRED');
    }

    const user = userData.user;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id,full_name,role,phone')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile || !roles.includes(profile.role)) {
      await client.auth.signOut();
      location.replace('/?account=login&error=access_denied');
      throw new Error('ACCESS_DENIED');
    }

    return { client, user, profile };
  }

  window.KWAuth = Object.freeze({
    getClient,
    requireRole
  });
})();
