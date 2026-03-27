//KONFIGURASI SUPABASE

const CONFIG = {
    SUPABASE_URL: 'https://fgawodvnrvrncebomjwu.supabase.co',

    SUPABASE_ANON_KEY: 'sb_publishable_etivxE7GiA_HNTepy4n99Q_IVxaapwK',

    DATA_ANGKATAN: {
        totalSiswa: 68,
        tahunLulus: 2026
    }
};

// Supabase client singleton
let _supabaseClient = null;

function getSupabaseClient() {
    if (!_supabaseClient) {
        _supabaseClient = supabase.createClient(
            CONFIG.SUPABASE_URL,
            CONFIG.SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                },
                global: {
                    headers: {
                        'X-Client-Info': 'pernah-di-sini/1.0',
                    },
                },
            }
        );
    }
    return _supabaseClient;
}
