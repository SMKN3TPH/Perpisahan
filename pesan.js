/**
 * pesan.js
 * Halaman Pesan — Pernah di Sini
 * Dibangun berdasarkan referensi messages.js + security.js yang lebih matang
 */

// ── KATA DILARANG (dari security.js referensi) ──
const KATA_DILARANG = [
    // ── Makian umum Indonesia ──
    'kontol','memek','anjing','bangsat','jancok','jembut',
    'bajingan','ngentot','pepek','colmek','jancuk','kimak',
    'pantek','kntl','mmk','ajg','bgst','kampret','asu',
    'puki','pukimak','pukima','meki','hancok','brengsek',
    'keparat','sialan','bedebah','kurang ajar','goblok',
    'tolol','idiot','bego','dungu','bodoh sekali',
    'tai','taik','tahi','setan','iblis','lonte','pelacur',
    'sundal','jablay','jablai','babi','monyet','celeng',
    'bangke','bangkai','kadal','brengsek','sontoloyo',
    'semprul','mampus','persetan','sial','terkutuk',
    'kafir','laknat','terlaknat','jahanam',

    // ── Singkatan / leet ──
    'tb','tl','gblk','tll','idiot','bgs','bst',
    'k0nt0l','m3m3k','4nji ng','b4bi',

    // ── SARA & diskriminasi ──
    'kafir','pribumi','cina babi','negro','nigger','keling',
    'inlander','china','chink','gook','jap',

    // ── Hinaan seksual ──
    'pelacur','lonte','sundal','jablay','jablai','mucikari',
    'prostitusi','esek esek','bokep','porn',

    // ── Bahasa Inggris umum ──
    'fuck','shit','bitch','dick','pussy','cunt','whore',
    'slut','bastard','motherfucker','dickhead','asshole',
    'ass','damn','crap','piss','cock','penis','vagina',
    'retard','stupid','idiot','dumbass','moron',

    // ── Ancaman / kekerasan ──
    'bunuh','habisi','matiin','siksa','gebuk','hajar',
    'jidat','pukul','tampar','tendang','tusuk',
];

// Kata yang perlu pengecekan substring (tanpa word boundary)
// karena sering tersembunyi di tengah kata
const SUBSTRING_CHECK = [
    'babi','anjing','monyet','goblok','tolol','idiot',
    'kontol','memek','ngentot','pepek','bangsat','bajingan',
    'fuck','shit','bitch','cunt','ass',
];

const EMOJI_REACTIONS = ['😭','❤️','🔥','👏','😂'];

// ── INIT ──
// loadPesan() dipanggil dari initUserSession() callback di pesan.html
// setelah profil user siap — mencegah konten muncul sebelum profil ada
document.addEventListener('DOMContentLoaded', () => {
    updateQuotaInfo();
    bindCharCount();
    setupFilterButtons();
    // loadPesan('semua') dipanggil dari pesan.html setelah initUserSession selesai
});


// ════════════════════════════════
// LOAD & RENDER PESAN
// ════════════════════════════════

let currentFilter = 'semua';

async function loadPesan(filterJurusan = 'semua') {
    currentFilter = filterJurusan;
    const container = document.getElementById('messages-list');
    if (!container) return;

    // Spinner — sama persis dengan referensi
    container.innerHTML = `
        <div style="text-align:center;padding:48px;color:var(--text-muted)">
            <div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--gold);
                        border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px"></div>
            <p style="font-size:13px">Memuat pesan...</p>
        </div>`;

    const messages = await fetchPesan(filterJurusan);

    if (!messages.length) {
        container.innerHTML = `
            <div style="text-align:center;padding:48px;color:var(--text-muted);font-size:13px">
                <p style="margin-bottom:8px">Belum ada pesan untuk kategori ini.</p>
                <p>Jadilah yang pertama meninggalkan kesan!</p>
            </div>`;
        return;
    }

    container.innerHTML = messages.map(m => buildCard(m)).join('');

    // Pasang event listener like & report via event delegation
    container.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const id  = parseInt(this.dataset.id);
            const cur = parseInt(this.dataset.likes || '0');
            const r   = await likePesan(id);
            if (r.count !== null) {
                this.dataset.likes = r.count;
                const span = this.querySelector('.like-count');
                if (span) span.textContent = r.count;
            }
            this.classList.toggle('liked', r.liked);
            const icon = this.querySelector('svg');
            if (icon) icon.setAttribute('fill', r.liked ? 'currentColor' : 'none');
        });
    });

    container.querySelectorAll('.report-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            handleLaporPesan(parseInt(this.dataset.id));
        });
    });

    // Update count badge filter
    updateFilterCounts(messages);
}

function buildCard(m) {
    const liked   = localStorage.getItem(`pds_like_${m.id}`) === '1';
    const timeAgo = formatTimeAgo(m.created_at);

    const reaksiBadges = Object.entries(m.reaksi || {})
        .filter(([,c]) => c > 0)
        .map(([e,c]) => `<span class="reaction-count" onclick="handleReaksiPesan(${m.id},'${e}')">${e} ${c}</span>`)
        .join('');

    return `
        <div class="message-card" id="msg-card-${m.id}">
            <div class="message-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:40px;height:40px;background:var(--bg-raised);
                                border:1px solid var(--border-gold);display:flex;align-items:center;
                                justify-content:center;font-family:'Playfair Display',serif;
                                font-size:16px;font-weight:700;color:var(--gold);flex-shrink:0">
                        ${escHtml(m.nama.charAt(0).toUpperCase())}
                    </div>
                    <div>
                        <div class="message-author">${escHtml(m.nama)}</div>
                        <div class="message-meta">${escHtml(m.peran || m.jurusan || '')}</div>
                    </div>
                </div>
                <span class="message-time">${timeAgo}</span>
            </div>

            <div class="message-text">${escHtml(m.isi)}</div>

            <div class="message-actions">
                <button class="action-btn like-btn ${liked ? 'liked' : ''}"
                        data-id="${m.id}" data-likes="${m.likes || 0}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}"
                         stroke="currentColor" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                    <span class="like-count">${m.likes || 0}</span>
                </button>

                <div class="reaction-pills" id="pills-${m.id}">${reaksiBadges}</div>

                <button class="react-trigger-btn" onclick="toggleReactPicker(${m.id})">😊</button>

                <button class="report-btn action-btn" data-id="${m.id}"
                        style="margin-left:auto;opacity:0.5;font-size:11px">
                    Laporkan
                </button>
            </div>

            <div class="react-picker hidden" id="react-picker-${m.id}">
                ${EMOJI_REACTIONS.map(e => {
                    const active = localStorage.getItem(`pds_react_${m.id}_${e}`) === '1';
                    return `<button class="emoji-react-btn ${active ? 'active' : ''}"
                                    onclick="handleReaksiPesan(${m.id},'${e}')">${e}</button>`;
                }).join('')}
            </div>
        </div>`;
}


// ════════════════════════════════
// INTERAKSI
// ════════════════════════════════

function toggleReactPicker(id) {
    document.querySelectorAll('.react-picker').forEach(p => {
        if (p.id !== `react-picker-${id}`) p.classList.add('hidden');
    });
    document.getElementById(`react-picker-${id}`)?.classList.toggle('hidden');
}

async function handleReaksiPesan(pesanId, emoji) {
    await reaktPesan(pesanId, emoji);
    document.getElementById(`react-picker-${pesanId}`)?.classList.add('hidden');

    // Refresh reaksi card ini saja
    const messages = await fetchPesan(currentFilter);
    const msg = messages.find(m => m.id === pesanId);
    if (msg) {
        const pills = document.getElementById(`pills-${pesanId}`);
        if (pills) {
            pills.innerHTML = Object.entries(msg.reaksi || {})
                .filter(([,c]) => c > 0)
                .map(([e,c]) => `<span class="reaction-count" onclick="handleReaksiPesan(${pesanId},'${e}')">${e} ${c}</span>`)
                .join('');
        }
        // Update active state tombol picker
        const picker = document.getElementById(`react-picker-${pesanId}`);
        if (picker) {
            picker.querySelectorAll('.emoji-react-btn').forEach(btn => {
                const e = btn.textContent;
                btn.classList.toggle('active', localStorage.getItem(`pds_react_${pesanId}_${e}`) === '1');
            });
        }
    }
    showToast('Reaksi diberikan!');
}

async function handleLaporPesan(pesanId) {
    if (!confirm('Laporkan pesan ini sebagai tidak pantas?')) return;
    const ok = await laporPesan(pesanId);
    showToast(ok ? '✅ Laporan terkirim! Admin akan meninjau.' : '❌ Gagal mengirim laporan');
}

window.handleReaksiPesan = handleReaksiPesan;
window.toggleReactPicker  = toggleReactPicker;


// ════════════════════════════════
// KIRIM PESAN
// ════════════════════════════════

async function submitMessage() {
    // Semua identitas dari UserMemory — tidak ada form input nama/role
    const profile = UserMemory.get();
    if (!profile) {
        showToast('❌ Profil tidak ditemukan, coba refresh halaman');
        return;
    }

    const nama    = profile.name;
    const jurusan = profile.jurusan || profile.role || 'Anonim';
    const isi     = document.getElementById('msg-text').value.trim();

    if (!isi) { showToast('❌ Tulis pesanmu terlebih dahulu'); return; }

    // Cek apakah pengiriman masih aktif
    if (!isPesanOpen()) {
        if (_pesanClosed) {
            showToast('📖 Masa pengiriman pesan sudah berakhir');
        } else {
            showToast('⏰ Pengiriman pesan ditutup pukul 22.00–06.00');
        }
        return;
    }

    // Cek ban dari database (lebih kuat dari localStorage)
    const banStatus = await cekBanStatus();
    if (banStatus.banned) {
        const exp = banStatus.isPermanent
            ? 'Permanen'
            : banStatus.expiresAt
                ? `sampai ${new Date(banStatus.expiresAt).toLocaleDateString('id-ID', {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}`
                : '';
        showToast(`🚫 Kamu dibanned: ${banStatus.reason}${exp ? ' · ' + exp : ''}`);
        // Update local state juga
        _saveLog({ banned: true, banExpiry: banStatus.expiresAt ? new Date(banStatus.expiresAt).getTime() : Date.now() + 999999999, entries: [] });
        updateQuotaInfo();
        return;
    }

    const kasarNama = cekKataKasar(nama);
    if (kasarNama) { showToast(kasarNama); return; }

    const kasarIsi = cekKataKasar(isi);
    if (kasarIsi)  { showToast(kasarIsi); return; }

    // Validasi URL
    if (/(https?:\/\/|www\.)[^\s]+/gi.test(isi)) {
        showToast('❌ Pesan tidak boleh mengandung link/URL');
        return;
    }

    const btn = document.getElementById('submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Mengirim…'; }

    const result = await kirimPesan(nama, jurusan, isi, profile);

    if (btn) {
        btn.disabled  = false;
        btn.innerHTML = `Kirim Pesan <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    }

    showToast(result.message);
    updateQuotaInfo();

    if (result.ok) {
        document.getElementById('msg-text').value = '';
        document.getElementById('char-count').textContent = '0';
        setTimeout(() => loadPesan(currentFilter), 800);
    }
}
window.submitMessage = submitMessage;


// ════════════════════════════════
// FILTER JURUSAN
// ════════════════════════════════

function setupFilterButtons() {
    document.querySelectorAll('[data-jurusan]').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('[data-jurusan]').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            loadPesan(this.dataset.jurusan);
        });
    });
}

function updateFilterCounts(messages) {
    const counts = { semua: messages.length };
    messages.forEach(m => {
        if (m.jurusan) counts[m.jurusan] = (counts[m.jurusan] || 0) + 1;
    });
    document.querySelectorAll('[data-jurusan] .count-badge').forEach(badge => {
        const key = badge.closest('[data-jurusan]').dataset.jurusan;
        badge.textContent = counts[key] || 0;
    });
}


// ════════════════════════════════
// VALIDASI KATA KASAR (dari security.js)
// ════════════════════════════════

function cekKataKasar(teks) {
    if (!teks || typeof teks !== 'string') return null;

    const kecil = teks.toLowerCase().trim();

    // ── Gabungkan kata dari DB + hardcode ──
    const dbWords = getBlockedWords().map(w => w.word);  // dari supabase.js cache
    const allWords = [...new Set([...KATA_DILARANG, ...dbWords])];

    // ── Normalisasi leet speak & variasi ──
    function normalize(str) {
        return str
            .replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e')
            .replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t')
            .replace(/9/g,'g').replace(/8/g,'b').replace(/6/g,'g')
            .replace(/@/g,'a').replace(/!/g,'i').replace(/\$/g,'s')
            .replace(/\+/g,'t').replace(/\*/g,'a').replace(/\|/g,'i')
            // Hapus spasi & tanda baca di antara huruf (b a b i → babi)
            .replace(/([a-z])[\s._\-]+(?=[a-z])/g,'$1');
    }

    const norm    = normalize(kecil);
    // Versi tanpa spasi sama sekali (b  a  b  i → babi)
    const nospace = kecil.replace(/\s+/g,'');
    const normNoSpace = normalize(nospace);

    // ── CEK 1: word boundary match ──
    for (const kata of KATA_DILARANG) {
        const escaped = kata.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if (new RegExp('\\b' + escaped + '\\b','i').test(kecil))
            return '❌ Pesan mengandung kata yang tidak pantas';
        if (new RegExp('\\b' + escaped + '\\b','i').test(norm))
            return '❌ Pesan mengandung kata yang tidak pantas';
    }

    // ── CEK 2: substring match untuk kata-kata rawan ──
    const allSubCheck = [...new Set([...SUBSTRING_CHECK, ...dbWords])];
    for (const kata of allSubCheck) {
        if (nospace.includes(kata))
            return '❌ Pesan mengandung kata yang tidak pantas';
        if (normNoSpace.includes(normalize(kata)))
            return '❌ Pesan mengandung kata yang tidak pantas';
    }

    // ── CEK 3: huruf berulang (babbbbii, fuuuuck) ──
    for (const kata of SUBSTRING_CHECK) {
        // buat pattern: setiap huruf boleh diulang (b+a+b+i+)
        const elongated = kata.split('').map(c =>
            c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '+'
        ).join('');
        if (new RegExp('\\b' + elongated + '\\b','i').test(kecil))
            return '❌ Pesan mengandung kata yang tidak pantas';
    }

    // ── CEK 4: karakter berulang spam (aaaaaaa) ──
    if (/(.){5,}/.test(teks))
        return '❌ Pesan mengandung pola spam (karakter berulang)';

    // ── CEK 5: semua huruf caps (MARAH) ──
    const words = teks.trim().split(/\s+/);
    const capsCount = words.filter(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)).length;
    if (capsCount >= 3)
        return '❌ Harap tidak menggunakan huruf kapital semua';

    // ── CEK 6: link / URL ──
    if (/(https?:\/\/|www\.)[^\s]+/gi.test(teks))
        return '❌ Pesan tidak boleh mengandung link/URL';

    return null;
}


// ════════════════════════════════
// HELPERS
// ════════════════════════════════

function bindCharCount() {
    const ta = document.getElementById('msg-text');
    if (!ta) return;
    ta.addEventListener('input', () => {
        const n = ta.value.length;
        const el = document.getElementById('char-count');
        if (el) {
            el.textContent = n;
            el.style.color = n > 270 ? '#E05C50' : 'var(--text-dim)';
        }
    });
}

function updateQuotaInfo() {
    const el = document.getElementById('quota-info');
    if (!el) return;
    if (isBanned()) {
        el.innerHTML = `🚫 Kamu sedang dibanned karena terlalu banyak mengirim pesan`;
        el.style.borderColor = 'rgba(192,57,43,0.4)';
        el.style.background  = 'rgba(192,57,43,0.06)';
        return;
    }
    const sisa = getSisaKuota();
    el.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" style="flex-shrink:0">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Tersisa <strong>${sisa}</strong> pesan dalam 4 jam · Dimoderasi sebelum tampil`;
}

// ════════════════════════════════
// STATUS PENGIRIMAN PESAN
// ════════════════════════════════

// Tanggal penutupan diambil dari Supabase (tabel site_config)
// key: 'pesan_close_date', value: ISO date string misal "2025-07-14T23:59:59"
// Kalau tidak ada di DB → sistem aktif terus sampai admin set
let _pesanCloseDate = null;  // null = belum diketahui
let _pesanClosed    = false; // true = sudah melewati masa aktif

async function loadPesanConfig() {
    try {
        const db = getSupabaseClient();
        const { data } = await db
            .from('site_config')
            .select('value')
            .eq('key', 'pesan_close_date')
            .maybeSingle();

        if (data?.value) {
            _pesanCloseDate = new Date(data.value);
            _pesanClosed    = new Date() > _pesanCloseDate;
        }
    } catch { /* silent — anggap aktif */ }
}

// Cek status dan tampilkan banner / lock form jika perlu
// Dipanggil setelah loadPesanConfig()
function checkPesanStatus() {
    // 1. Cek apakah masa aktif sudah habis
    if (_pesanClosed) {
        _lockFormReadOnly();
        return;
    }

    // 2. Cek jam malam
    const h = new Date().getHours();
    if (h < 6 || h >= 22) {
        _showBanner(
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Pengiriman pesan ditutup pukul 22.00 – 06.00`,
            'night-banner'
        );
        _disableSubmit();
    }
}

function _lockFormReadOnly() {
    // Sembunyikan form, tampilkan pesan read-only
    const form = document.getElementById('pesan-form');
    if (form) {
        form.innerHTML = `
            <div style="text-align:center;padding:32px 0">
                <div style="width:52px;height:52px;background:var(--bg-raised);border:1px solid var(--border-gold);
                            display:flex;align-items:center;justify-content:center;margin:0 auto 16px;
                            font-size:22px">📖</div>
                <h3 style="font-family:'Playfair Display',serif;font-size:20px;font-style:italic;
                           color:var(--text);margin-bottom:8px">Buku Pesan Ditutup</h3>
                <p style="font-size:13px;color:var(--text-muted);line-height:1.7;max-width:280px;margin:0 auto">
                    Masa pengiriman pesan telah berakhir.<br>
                    Kamu masih bisa membaca semua pesan di bawah.
                </p>
                ${_pesanCloseDate ? `<p style="font-size:11px;color:var(--text-dim);margin-top:12px;letter-spacing:0.5px">
                    Ditutup pada ${_pesanCloseDate.toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}
                </p>` : ''}
            </div>`;
    }
}

function _showBanner(html, className) {
    const form = document.getElementById('pesan-form');
    if (!form) return;
    const existing = form.querySelector('.' + className);
    if (existing) return; // sudah ada
    const banner = document.createElement('div');
    banner.className = className;
    banner.innerHTML = html;
    const title = form.querySelector('.form-title');
    if (title) title.insertAdjacentElement('afterend', banner);
    else form.prepend(banner);
}

function _disableSubmit() {
    const btn = document.getElementById('submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
}

function isPesanOpen() {
    if (_pesanClosed) return false;
    const h = new Date().getHours();
    if (h < 6 || h >= 22) return false;
    return true;
}

function formatTimeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m    = Math.floor(diff / 60000);
    if (m < 1)  return 'Baru saja';
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    const d = Math.floor(h / 24);
    if (d < 7)  return `${d} hari lalu`;
    return `${Math.floor(d / 7)} minggu lalu`;
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 4000);
}
