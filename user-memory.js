/**
 * user-memory.js
 * Sistem identitas user — Pernah di Sini
 *
 * Alur:
 * 1. Cek localStorage / cookie → langsung pakai
 * 2. Generate fingerprint device
 * 3. Cek Supabase (user_profiles) pakai fingerprint → pakai kalau ketemu
 * 4. Cek pakai session_id → pakai kalau ketemu, update fingerprint-nya
 * 5. Tidak ketemu → tampilkan modal profil (blocking, tidak bisa ditutup)
 *
 * Setelah profil tersimpan:
 * - localStorage (instant access)
 * - Cookie 30 hari (lintas tab)
 * - Supabase user_profiles (lintas device via fingerprint)
 */

const UserMemory = {
    currentUser: null,  // { name, role, jurusan }

    // ════════════════════════════════
    // COOKIE
    // ════════════════════════════════
    cookie: {
        set(name, value, days = 30) {
            const d = new Date();
            d.setTime(d.getTime() + days * 86400000);
            document.cookie = `${name}=${JSON.stringify(value)};expires=${d.toUTCString()};path=/;SameSite=Strict`;
        },
        get(name) {
            for (const part of document.cookie.split('; ')) {
                const [k, v] = part.split('=');
                if (k === name) { try { return JSON.parse(decodeURIComponent(v)); } catch { return v; } }
            }
            return null;
        },
        delete(name) {
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
        },
    },

    // ════════════════════════════════
    // FINGERPRINT
    // ════════════════════════════════
    fingerprint: {
        async get() {
            let fp = localStorage.getItem('_device_fp');
            if (fp) return fp;
            fp = await this._generate();
            localStorage.setItem('_device_fp', fp);
            return fp;
        },

        async _generate() {
            // Deteksi device type
            const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            const isTablet  = /iPad|Tablet/i.test(navigator.userAgent);
            const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

            // Komponen yang stabil di semua device
            // Hindari screen.width/height karena bisa berubah saat resize di desktop
            const raw = [
                // Browser & OS (potong versi angka supaya tidak berubah tiap update)
                navigator.userAgent.replace(/[\d.]+/g, '').slice(0, 80),
                navigator.language,
                navigator.languages?.join(',') || '',
                new Date().getTimezoneOffset(),
                navigator.hardwareConcurrency || 0,
                navigator.platform || '',
                deviceType,
                // Fitur browser (stable)
                !!window.indexedDB,
                !!window.localStorage,
                !!window.sessionStorage,
                typeof window.ontouchstart !== 'undefined',
                screen.colorDepth,
                // Resolusi hanya untuk mobile (tidak resize-able)
                isMobile ? `${screen.width}x${screen.height}` : 'desktop',
            ].join('|');

            if (window.crypto?.subtle) {
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
            }
            return btoa(unescape(encodeURIComponent(raw))).replace(/[^a-z0-9]/gi, '').slice(0, 40);
        },
    },

    // ════════════════════════════════
    // SUPABASE HELPERS
    // ════════════════════════════════
    async _findByFingerprint(fp) {
        try {
            const db = getSupabaseClient();
            const { data } = await db
                .from('user_profiles')
                .select('username, role, jurusan')
                .eq('device_fingerprint', fp)
                .maybeSingle();
            return data;
        } catch { return null; }
    },

    async _findBySession(sid) {
        try {
            const db = getSupabaseClient();
            const { data } = await db
                .from('user_profiles')
                .select('username, role, jurusan')
                .eq('session_id', sid)
                .maybeSingle();
            return data;
        } catch { return null; }
    },

    async _create(profile, fp) {
        try {
            const db  = getSupabaseClient();
            const sid = this._sessionId();
            // Upsert — kalau fingerprint sudah ada, update saja (tidak duplikat)
            await db.from('user_profiles').upsert([{
                session_id:         sid,
                device_fingerprint: fp,
                username:           profile.name,
                role:               profile.role,
                jurusan:            profile.jurusan || null,
                last_seen:          new Date().toISOString(),
            }], { onConflict: 'device_fingerprint' });
            return true;
        } catch { return false; }
    },

    async _updateFp(sid, fp) {
        try {
            const db = getSupabaseClient();
            await db.from('user_profiles')
                .update({ device_fingerprint: fp, last_seen: new Date().toISOString() })
                .eq('session_id', sid);
        } catch {}
    },

    async _updateLastSeen(fp) {
        try {
            const db = getSupabaseClient();
            await db.from('user_profiles')
                .update({ last_seen: new Date().toISOString() })
                .eq('device_fingerprint', fp);
        } catch {}
    },

    _sessionId() {
        let sid = sessionStorage.getItem('_sid');
        if (!sid) {
            sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('_sid', sid);
        }
        return sid;
    },

    // ════════════════════════════════
    // INIT — panggil di setiap halaman yang butuh profil
    // Returns: user object | null
    // ════════════════════════════════
    async init() {
        // 1. localStorage
        try {
            const cached = localStorage.getItem('_user_profile');
            if (cached) {
                this.currentUser = JSON.parse(cached);
                // Update last seen di background
                setTimeout(() => this.fingerprint.get().then(fp => this._updateLastSeen(fp)), 2000);
                return this.currentUser;
            }
        } catch {}

        // 2. Cookie
        const fromCookie = this.cookie.get('_user_profile');
        if (fromCookie) {
            this.currentUser = fromCookie;
            localStorage.setItem('_user_profile', JSON.stringify(fromCookie));
            return this.currentUser;
        }

        // 3. Fingerprint → Supabase
        const fp = await this.fingerprint.get();
        const byFp = await this._findByFingerprint(fp);
        if (byFp) {
            this.currentUser = { name: byFp.username, role: byFp.role, jurusan: byFp.jurusan };
            this._cacheLocally(this.currentUser);
            return this.currentUser;
        }

        // 4. Session ID → Supabase (fallback lintas halaman)
        const sid    = this._sessionId();
        const bySid  = await this._findBySession(sid);
        if (bySid) {
            this.currentUser = { name: bySid.username, role: bySid.role, jurusan: bySid.jurusan };
            this._cacheLocally(this.currentUser);
            this._updateFp(sid, fp); // update fingerprint supaya next time cepat
            return this.currentUser;
        }

        // 5. Tidak ketemu → perlu onboarding
        return null;
    },

    // ════════════════════════════════
    // SAVE — dipanggil setelah modal profil disubmit
    // ════════════════════════════════
    async save(profile) {
        // { name, role, jurusan }
        this.currentUser = profile;
        this._cacheLocally(profile);

        const fp = await this.fingerprint.get();
        await this._create(profile, fp);
        return true;
    },

    _cacheLocally(profile) {
        localStorage.setItem('_user_profile', JSON.stringify(profile));
        this.cookie.set('_user_profile', profile, 30);
    },

    // ════════════════════════════════
    // GETTERS
    // ════════════════════════════════
    get() {
        if (this.currentUser) return this.currentUser;
        try {
            const c = localStorage.getItem('_user_profile');
            if (c) { this.currentUser = JSON.parse(c); return this.currentUser; }
        } catch {}
        return null;
    },

    isLoggedIn() {
        return !!this.get();
    },

    // ════════════════════════════════
    // LOGOUT / GANTI PROFIL
    // ════════════════════════════════
    logout() {
        localStorage.removeItem('_user_profile');
        localStorage.removeItem('_device_fp');
        this.cookie.delete('_user_profile');
        this.currentUser = null;
    },
};


// ════════════════════════════════════════════
// PROFILE MODAL — UI blocking onboarding
// ════════════════════════════════════════════

const ProfileModal = {
    el: null,
    onSuccess: null,  // callback setelah profil tersimpan

    // Buat dan inject modal ke DOM
    inject() {
        if (document.getElementById('profile-modal')) return;

        const el = document.createElement('div');
        el.id = 'profile-modal';
        el.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.88);
            z-index:1000; display:flex; align-items:center; justify-content:center;
            padding:20px; animation:fadeIn 0.3s ease;
        `;

        el.innerHTML = `
            <div style="
                background:var(--bg-card); border:1px solid var(--border);
                max-width:400px; width:100%; padding:36px; position:relative;
                animation:pageIn 0.35s ease;
            ">
                <!-- Gold top line -->
                <div style="position:absolute;top:0;left:0;right:0;height:2px;
                            background:linear-gradient(90deg,transparent,var(--gold),transparent)"></div>

                <!-- Header -->
                <div style="text-align:center;margin-bottom:28px">
                    <div style="
                        width:56px;height:56px;background:var(--bg-raised);
                        border:1px solid var(--border-gold);display:flex;align-items:center;
                        justify-content:center;margin:0 auto 16px;
                        font-family:'Playfair Display',serif;font-size:24px;color:var(--gold)
                    ">✦</div>
                    <h2 style="font-family:'Playfair Display',serif;font-size:22px;font-style:italic;
                               color:var(--text);margin-bottom:6px">Selamat Datang</h2>
                    <p style="font-size:13px;color:var(--text-muted);line-height:1.6">
                        Isi profilmu sekali, dan kamu tidak perlu mengisi lagi<br>di perangkat ini.
                    </p>
                </div>

                <!-- Form -->
                <form id="profile-form" onsubmit="return false">
                    <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px">

                        <div class="form-field">
                            <label>Nama <span style="color:var(--gold)">*</span></label>
                            <input type="text" id="pf-name" placeholder="Nama kamu"
                                   autocomplete="off" maxlength="50"
                                   style="background:var(--bg-raised);border:1px solid var(--border);
                                          color:var(--text);padding:10px 14px;font-family:'DM Sans',sans-serif;
                                          font-size:14px;outline:none;width:100%;transition:border-color 0.2s"
                                   onfocus="this.style.borderColor='var(--gold-dim)'"
                                   onblur="this.style.borderColor='var(--border)'">
                        </div>

                        <div class="form-field">
                            <label>Peran <span style="color:var(--gold)">*</span></label>
                            <select id="pf-role" onchange="ProfileModal.toggleJurusan()"
                                    style="background:var(--bg-raised);border:1px solid var(--border);
                                           color:var(--text);padding:10px 14px;font-family:'DM Sans',sans-serif;
                                           font-size:14px;outline:none;width:100%;transition:border-color 0.2s"
                                    onfocus="this.style.borderColor='var(--gold-dim)'"
                                    onblur="this.style.borderColor='var(--border)'">
                                <option value="">— Pilih peranmu —</option>
                                <option value="Siswa">Siswa</option>
                                <option value="Guru">Guru</option>
                                <option value="Alumni">Alumni</option>
                                <option value="Anonim">Anonim / Lainnya</option>
                            </select>
                        </div>

                        <div class="form-field" id="pf-jurusan-row" style="display:none">
                            <label>Jurusan</label>
                            <select id="pf-jurusan"
                                    style="background:var(--bg-raised);border:1px solid var(--border);
                                           color:var(--text);padding:10px 14px;font-family:'DM Sans',sans-serif;
                                           font-size:14px;outline:none;width:100%;transition:border-color 0.2s"
                                    onfocus="this.style.borderColor='var(--gold-dim)'"
                                    onblur="this.style.borderColor='var(--border)'">
                                <option value="">— Pilih jurusan —</option>
                                <option value="TSM">TSM — Teknik Sepeda Motor</option>
                                <option value="MP">MP — Manajemen Perkantoran</option>
                                <option value="ATP">ATP — Agribisnis Tanaman Perkebunan</option>
                                <option value="APHP">APHP — Agribisnis Pengolahan Hasil Pertanian</option>
                            </select>
                        </div>

                    </div>

                    <!-- Info -->
                    <div style="background:var(--bg-raised);border:1px solid var(--border);
                                padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)"
                             stroke-width="2" style="flex-shrink:0;margin-top:1px">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p style="font-size:11px;color:var(--text-muted);line-height:1.6">
                            Profilmu disimpan di perangkat ini. Namamu akan tampil di setiap pesan dan foto yang kamu kirim.
                        </p>
                    </div>

                    <button type="button" id="pf-submit-btn"
                            onclick="ProfileModal.submit()"
                            style="width:100%;background:var(--gold);border:none;color:var(--bg);
                                   font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;
                                   letter-spacing:1.5px;text-transform:uppercase;padding:15px;
                                   cursor:pointer;transition:background 0.2s"
                            onmouseover="this.style.background='var(--gold-bright)'"
                            onmouseout="this.style.background='var(--gold)'">
                        Lanjutkan →
                    </button>
                </form>
            </div>
        `;

        document.body.appendChild(el);
        this.el = el;

        // Focus nama otomatis
        setTimeout(() => document.getElementById('pf-name')?.focus(), 300);
    },

    toggleJurusan() {
        const role = document.getElementById('pf-role')?.value;
        const row  = document.getElementById('pf-jurusan-row');
        if (row) row.style.display = role === 'Siswa' || role === 'Alumni' ? 'flex' : 'none';
    },

    async submit() {
        const name    = document.getElementById('pf-name')?.value.trim();
        const role    = document.getElementById('pf-role')?.value;
        const jurusan = document.getElementById('pf-jurusan')?.value || null;

        // Validasi nama manusia
        const namaErr = validasiNamaManusia(name);
        if (namaErr) {
            this._shake('pf-name');
            showProfileToast(namaErr, 'error');
            return;
        }
        if (!role) {
            this._shake('pf-role');
            showProfileToast('Pilih peranmu terlebih dahulu', 'error');
            return;
        }

        const btn = document.getElementById('pf-submit-btn');
        if (btn) { btn.textContent = 'Menyimpan…'; btn.disabled = true; }

        const profile = { name, role, jurusan };
        await UserMemory.save(profile);

        // Tutup modal
        if (this.el) {
            this.el.style.animation = 'fadeOut 0.2s ease forwards';
            setTimeout(() => { this.el?.remove(); this.el = null; }, 200);
        }
        document.body.style.overflow = 'auto';

        // Tampilkan welcome message
        showWelcomeNew(profile);

        // Jalankan callback (misal: load galeri)
        if (typeof this.onSuccess === 'function') this.onSuccess(profile);
    },

    _shake(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.style.animation = 'shake 0.3s ease';
        setTimeout(() => el.style.animation = '', 400);
    },

    show(onSuccess) {
        this.onSuccess = onSuccess || null;
        document.body.style.overflow = 'hidden';
        this.inject();
    },
};


// ════════════════════════════════════════════
// WELCOME NOTIFICATIONS
// ════════════════════════════════════════════

function showWelcomeBack(user) {
    const msgs = {
        TSM:  'Siap-siap kangen sama bengkel dan suara motor ya? 🏍️',
        MP:   'Jangan lupa kenangan di lab administrasi! 📋',
        ATP:  'Tanaman-tanamanmu pasti kangen disiram! 🌱',
        APHP: 'Masak bareng lagi yuk? 🍳',
    };
    const sub = user.role === 'Guru'
        ? 'Terima kasih sudah mendidik kami 🙏'
        : user.role === 'Alumni'
        ? 'Welcome back, alumni! 🎓'
        : msgs[user.jurusan] || 'Selamat datang kembali! 👋';

    _showToastCard(`Halo lagi, <strong>${escHtmlProfile(user.name)}!</strong>`, sub);
}

function showWelcomeNew(profile) {
    const msgs = {
        TSM:  'Suara motor TSM paling kencang! 🏍️',
        MP:   'Admin terbaik angkatan! 📋',
        ATP:  'Green thumb sejati! 🌱',
        APHP: 'Chef berbakat! 🍳',
    };
    const sub = profile.role === 'Guru'
        ? 'Terima kasih Pak/Bu, sudah bergabung! 🙏'
        : profile.role === 'Alumni'
        ? 'Welcome back, alumni! 🎓'
        : msgs[profile.jurusan] || 'Selamat bergabung! 👋';

    _showToastCard(`Hai, <strong>${escHtmlProfile(profile.name)}!</strong>`, sub);
}

function _showToastCard(title, sub) {
    const card = document.createElement('div');
    card.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(80px);
        background:var(--bg-card); border:1px solid var(--border-gold);
        padding:16px 24px; z-index:9997; font-size:13px; color:var(--text);
        min-width:240px; text-align:center; transition:transform 0.35s ease;
        pointer-events:none;
    `;
    card.innerHTML = `<div>${title}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">${sub}</div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { card.style.transform = 'translateX(-50%) translateY(0)'; });
    });
    setTimeout(() => {
        card.style.transform = 'translateX(-50%) translateY(80px)';
        setTimeout(() => card.remove(), 400);
    }, 3500);
}

function showProfileToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000); return; }
    // Fallback kalau tidak ada toast element
    alert(msg);
}

function escHtmlProfile(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ════════════════════════════════════════════
// INJECT CSS ANIMATIONS
// ════════════════════════════════════════════
(function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes fadeOut { from{opacity:1} to{opacity:0} }
        @keyframes shake   {
            0%,100%{transform:translateX(0)}
            20%{transform:translateX(-6px)}
            40%{transform:translateX(6px)}
            60%{transform:translateX(-4px)}
            80%{transform:translateX(4px)}
        }

        /* Profil chip di navbar */
        #profile-chip {
            display:inline-flex; align-items:center; gap:8px;
            background:var(--bg-card); border:1px solid var(--border);
            padding:5px 10px; cursor:pointer; transition:border-color 0.2s;
            font-family:'DM Sans',sans-serif; font-size:11px; color:var(--text-muted);
            flex-shrink:0; white-space:nowrap; margin-left:4px;
        }
        #profile-chip:hover { border-color:var(--border-gold); color:var(--text); }
        #profile-chip .chip-avatar {
            width:22px; height:22px; background:var(--gold-dim);
            display:flex; align-items:center; justify-content:center;
            font-size:11px; font-weight:700; color:var(--bg);
            font-family:'Playfair Display',serif; flex-shrink:0;
        }

        /* Modal ganti nama */
        #rename-modal-overlay {
            position:fixed; inset:0; background:rgba(0,0,0,0.82);
            z-index:600; display:none; align-items:center; justify-content:center; padding:20px;
        }
        #rename-modal-overlay.open { display:flex; }
        #rename-modal-box {
            background:var(--bg-card); border:1px solid var(--border);
            max-width:380px; width:100%; padding:32px; position:relative; animation:pageIn 0.3s ease;
        }
        #rename-modal-box::before {
            content:''; position:absolute; top:0; left:0; right:0; height:2px;
            background:linear-gradient(90deg, transparent, var(--gold), transparent);
        }
    `;
    document.head.appendChild(style);
})();


// ════════════════════════════════════════════
// PROFILE CHIP — tampil di navbar setelah login
// ════════════════════════════════════════════
function injectProfileChip(user) {
    const nav = document.querySelector('.navbar-links');
    if (!nav || document.getElementById('profile-chip')) return;

    const chip = document.createElement('div');
    chip.id    = 'profile-chip';
    chip.title = 'Lihat profil';
    chip.onclick = () => RenameModal.show(user);

    const initial = (user.name || '?').charAt(0).toUpperCase();
    chip.innerHTML = `
        <div class="chip-avatar">${escHtmlProfile(initial)}</div>
        <span>${escHtmlProfile(user.name)}</span>
    `;
    nav.appendChild(chip);
}


// ════════════════════════════════════════════
// MAIN INIT FUNCTION — panggil di galeri.html & pesan.html
// initUserSession(onReady) → onReady(user) dipanggil kalau profil sudah ada
// ════════════════════════════════════════════
async function initUserSession(onReady) {
    let user = await UserMemory.init();

    if (user) {
        // Cek dan terapkan rename yang sudah diapprove admin (background)
        await applyApprovedRename();
        // Ambil ulang setelah possible rename
        user = UserMemory.get() || user;

        injectProfileChip(user);

        // Welcome back hanya sekali per sesi
        if (!sessionStorage.getItem('_welcomed')) {
            sessionStorage.setItem('_welcomed', '1');
            showWelcomeBack(user);
        }

        if (typeof onReady === 'function') onReady(user);
    } else {
        // Profil tidak ditemukan → modal blocking, tidak bisa ditutup
        ProfileModal.show((newUser) => {
            sessionStorage.setItem('_welcomed', '1');
            injectProfileChip(newUser);
            if (typeof onReady === 'function') onReady(newUser);
        });
    }
}


// ════════════════════════════════════════════
// VALIDASI NAMA MANUSIA
// Nama harus terlihat seperti nama orang sungguhan:
// - Minimal 2 karakter
// - Hanya huruf, spasi, titik, apostrof, tanda hubung
// - Tidak boleh semua angka / karakter aneh
// - Tidak boleh kata yang jelas bukan nama (test, admin, user, dll)
// ════════════════════════════════════════════

const BUKAN_NAMA = [
    // Kata reserved/test
    'test','admin','user','guest','anonymous','anonim','unknown',
    'null','undefined','none','no name','noname','abc','xyz',
    'asdf','qwerty','lorem','ipsum','haha','wkwk','ngab',
    // Kata kasar dalam nama
    'babi','anjing','monyet','goblok','tolol','idiot','kontol',
    'memek','bangsat','bajingan','setan','iblis','lonte',
    'fuck','shit','bitch','asshole','bastard',
];

function validasiNamaManusia(nama) {
    if (!nama || typeof nama !== 'string') return 'Nama tidak boleh kosong';

    const trimmed = nama.trim();

    if (trimmed.length < 2)  return 'Nama minimal 2 karakter';
    if (trimmed.length > 50) return 'Nama maksimal 50 karakter';

    // Hanya huruf (termasuk aksen), spasi, titik, apostrof, tanda hubung
    if (!/^[a-zA-ZÀ-ÖØ-öø-ÿ\s.\-']+$/.test(trimmed))
        return 'Nama hanya boleh mengandung huruf dan spasi';

    // Tidak boleh semua satu huruf berulang (aaaaaa)
    if (/^(.)\1+$/.test(trimmed.replace(/\s/g, '')))
        return 'Nama tidak valid';

    // Minimal ada satu huruf
    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(trimmed))
        return 'Nama harus mengandung huruf';

    // Tidak boleh kata reserved
    const lower = trimmed.toLowerCase();
    for (const kata of BUKAN_NAMA) {
        if (lower === kata) return 'Gunakan nama aslimu ya 😊';
    }

    // Tidak boleh kata super pendek yg bukan nama (1 huruf saja)
    const words = trimmed.split(/\s+/);
    if (words.length === 1 && words[0].length < 2)
        return 'Nama terlalu pendek';

    return null; // valid
}


// ════════════════════════════════════════════
// RENAME MODAL — ganti nama dengan request ke admin
// ════════════════════════════════════════════

const RenameModal = {
    _user: null,

    show(user) {
        this._user = user;

        // Inject overlay kalau belum ada
        if (!document.getElementById('rename-modal-overlay')) {
            this._inject();
        }

        // Reset form
        const input = document.getElementById('rename-input');
        if (input) { input.value = user.name; input.select(); }
        document.getElementById('rename-status')?.remove();

        document.getElementById('rename-modal-overlay').classList.add('open');
        document.body.style.overflow = 'hidden';

        // Cek apakah sudah ada request pending
        this._checkPending(user);
    },

    close() {
        document.getElementById('rename-modal-overlay')?.classList.remove('open');
        document.body.style.overflow = 'auto';
    },

    _inject() {
        const el = document.createElement('div');
        el.id = 'rename-modal-overlay';
        el.innerHTML = `
            <div id="rename-modal-box">
                <button onclick="RenameModal.close()"
                        style="position:absolute;top:14px;right:14px;background:none;border:none;
                               font-size:20px;cursor:pointer;color:var(--text-muted);line-height:1;
                               transition:color 0.2s"
                        onmouseover="this.style.color='var(--text)'"
                        onmouseout="this.style.color='var(--text-muted)'">×</button>

                <h3 style="font-family:'Playfair Display',serif;font-size:20px;font-style:italic;
                           color:var(--text);margin-bottom:6px">Profil Kamu</h3>
                <p style="font-size:12px;color:var(--text-muted);margin-bottom:24px" id="rename-subtitle"></p>

                <!-- Info profil sekarang -->
                <div id="rename-profile-info"
                     style="background:var(--bg-raised);border:1px solid var(--border);
                            padding:14px;margin-bottom:20px;font-size:13px;color:var(--text-muted)">
                </div>

                <!-- Form ganti nama -->
                <div style="margin-bottom:20px">
                    <label style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;
                                  color:var(--text-dim);display:block;margin-bottom:8px">
                        Nama Baru
                    </label>
                    <input id="rename-input" type="text" maxlength="50"
                           placeholder="Ketik nama baru…"
                           style="width:100%;background:var(--bg-raised);border:1px solid var(--border);
                                  color:var(--text);padding:10px 14px;font-family:'DM Sans',sans-serif;
                                  font-size:14px;outline:none;transition:border-color 0.2s"
                           onfocus="this.style.borderColor='var(--gold-dim)'"
                           onblur="this.style.borderColor='var(--border)'"
                           onkeydown="if(event.key==='Enter') RenameModal.submit()">
                    <p id="rename-error"
                       style="font-size:11px;color:#E05C50;margin-top:6px;display:none"></p>
                </div>

                <!-- Info kebijakan -->
                <div style="background:rgba(185,155,90,0.06);border:1px solid var(--border-gold);
                            padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="var(--gold)" stroke-width="2" style="flex-shrink:0;margin-top:1px">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <p style="font-size:11px;color:var(--text-muted);line-height:1.6">
                        Permintaan ganti nama akan ditinjau oleh admin sebelum berlaku.
                        Gunakan nama aslimu ya.
                    </p>
                </div>

                <div style="display:flex;gap:10px">
                    <button onclick="RenameModal.close()"
                            style="flex:1;background:none;border:1px solid var(--border);
                                   padding:12px;font-family:'DM Sans',sans-serif;font-size:12px;
                                   color:var(--text-muted);cursor:pointer;transition:all 0.2s;letter-spacing:1px;text-transform:uppercase"
                            onmouseover="this.style.borderColor='var(--border-gold)';this.style.color='var(--text)'"
                            onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">
                        Tutup
                    </button>
                    <button id="rename-submit-btn"
                            onclick="RenameModal.submit()"
                            style="flex:2;background:var(--gold);border:none;
                                   padding:12px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;
                                   color:var(--bg);cursor:pointer;transition:background 0.2s;letter-spacing:1px;text-transform:uppercase"
                            onmouseover="this.style.background='var(--gold-bright)'"
                            onmouseout="this.style.background='var(--gold)'">
                        Kirim Permintaan
                    </button>
                </div>
            </div>
        `;

        // Tutup kalau klik overlay
        el.addEventListener('click', e => {
            if (e.target === el) this.close();
        });

        document.body.appendChild(el);
    },

    _setProfile(user) {
        const sub  = document.getElementById('rename-subtitle');
        const info = document.getElementById('rename-profile-info');
        if (sub) sub.textContent = `Sesi aktif sebagai ${user.name}`;
        if (info) info.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;justify-content:space-between">
                    <span style="color:var(--text-dim);font-size:11px;letter-spacing:1px;text-transform:uppercase">Nama</span>
                    <span style="color:var(--text)">${escHtmlProfile(user.name)}</span>
                </div>
                <div style="display:flex;justify-content:space-between">
                    <span style="color:var(--text-dim);font-size:11px;letter-spacing:1px;text-transform:uppercase">Peran</span>
                    <span style="color:var(--text)">${escHtmlProfile(user.role)}</span>
                </div>
                ${user.jurusan ? `
                <div style="display:flex;justify-content:space-between">
                    <span style="color:var(--text-dim);font-size:11px;letter-spacing:1px;text-transform:uppercase">Jurusan</span>
                    <span style="color:var(--text)">${escHtmlProfile(user.jurusan)}</span>
                </div>` : ''}
            </div>
        `;
    },

    async _checkPending(user) {
        this._setProfile(user);
        try {
            const db = getSupabaseClient();
            const fp = await UserMemory.fingerprint.get();
            const { data } = await db
                .from('user_change_requests')
                .select('new_name, status, created_at')
                .eq('device_fingerprint', fp)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (data) {
                // Ada request pending — tampilkan status, lock form
                const input  = document.getElementById('rename-input');
                const btn    = document.getElementById('rename-submit-btn');
                const errEl  = document.getElementById('rename-error');
                if (input) { input.value = data.new_name; input.disabled = true; input.style.opacity = '0.5'; }
                if (btn)   { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'Menunggu Persetujuan'; }
                if (errEl) {
                    errEl.style.color  = 'var(--gold)';
                    errEl.textContent  = `Permintaan ganti nama ke "${data.new_name}" sedang ditinjau admin.`;
                    errEl.style.display = 'block';
                }
            }
        } catch { /* silent */ }
    },

    async submit() {
        const newName = document.getElementById('rename-input')?.value.trim();
        const errEl   = document.getElementById('rename-error');

        // Reset error
        if (errEl) { errEl.style.display = 'none'; errEl.style.color = '#E05C50'; }

        // Validasi nama manusia
        const err = validasiNamaManusia(newName);
        if (err) {
            if (errEl) { errEl.textContent = err; errEl.style.display = 'block'; }
            document.getElementById('rename-input')?.focus();
            return;
        }

        // Sama dengan nama sekarang?
        if (newName.toLowerCase() === this._user?.name?.toLowerCase()) {
            if (errEl) { errEl.textContent = 'Nama baru sama dengan nama sekarang.'; errEl.style.display = 'block'; }
            return;
        }

        const btn = document.getElementById('rename-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Mengirim…'; }

        try {
            const db = getSupabaseClient();
            const fp = await UserMemory.fingerprint.get();

            // Cek apakah sudah ada request pending sebelumnya
            const { data: existing } = await db
                .from('user_change_requests')
                .select('id')
                .eq('device_fingerprint', fp)
                .eq('status', 'pending')
                .maybeSingle();

            if (existing) {
                if (errEl) {
                    errEl.style.color   = 'var(--gold)';
                    errEl.textContent   = 'Kamu sudah punya permintaan yang sedang ditinjau. Tunggu ya!';
                    errEl.style.display = 'block';
                }
                if (btn) { btn.disabled = false; btn.textContent = 'Kirim Permintaan'; }
                return;
            }

            // Insert request
            const { error } = await db.from('user_change_requests').insert([{
                device_fingerprint: fp,
                old_name:           this._user.name,
                new_name:           newName,
                role:               this._user.role,
                jurusan:            this._user.jurusan || null,
                status:             'pending',
            }]);

            if (error) throw error;

            // Sukses — lock form
            if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'Menunggu Persetujuan'; }
            const input = document.getElementById('rename-input');
            if (input) { input.disabled = true; input.style.opacity = '0.5'; }
            if (errEl) {
                errEl.style.color   = 'var(--gold)';
                errEl.textContent   = `✓ Permintaan terkirim! Namamu akan berubah ke "${newName}" setelah admin menyetujui.`;
                errEl.style.display = 'block';
            }

        } catch (e) {
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Kirim Permintaan'; }
            if (errEl) { errEl.textContent = 'Gagal mengirim permintaan. Coba lagi.'; errEl.style.display = 'block'; }
        }
    },
};


// ════════════════════════════════════════════
// TERAPKAN APPROVED RENAME
// Dipanggil saat init — cek apakah ada request yang sudah diapprove
// ════════════════════════════════════════════
async function applyApprovedRename() {
    try {
        const db = getSupabaseClient();
        const fp = await UserMemory.fingerprint.get();

        const { data } = await db
            .from('user_change_requests')
            .select('new_name, role, jurusan')
            .eq('device_fingerprint', fp)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!data) return;

        // Update profil lokal dengan nama baru
        const currentProfile = UserMemory.get();
        if (currentProfile && currentProfile.name !== data.new_name) {
            const updated = { ...currentProfile, name: data.new_name };
            UserMemory._cacheLocally(updated);
            UserMemory.currentUser = updated;

            // Update tabel user_profiles juga
            await db.from('user_profiles')
                .update({ username: data.new_name })
                .eq('device_fingerprint', fp);

            // Tandai request sebagai applied
            await db.from('user_change_requests')
                .update({ status: 'applied' })
                .eq('device_fingerprint', fp)
                .eq('status', 'approved');
        }
    } catch { /* silent */ }
}
