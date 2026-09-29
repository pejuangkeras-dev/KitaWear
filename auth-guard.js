/* KitaWear — Supabase Auth route guard for Cloudflare Pages */
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
              detectSessionInUrl: true
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
