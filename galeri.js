/**
 * galeri.js
 * Halaman Galeri — Pernah di Sini
 * Dibangun berdasarkan referensi gallery.js yang lebih matang
 */

// ── STATE ──
let currentAdminPage     = 1;
let currentUserPage      = 1;
const PER_PAGE           = 12;
let adminPhotos          = [];
let userPhotos           = [];
let currentAdminCategory = 'all';
let currentUserCategory  = 'all';
let currentUser          = null; // dari UserMemory atau form manual

const EMOJI_LIST = ['❤️','🔥','😂','😭','👏'];

// ── Status penutupan galeri ──
let _galeriClosed    = false;
let _galeriCloseDate = null;

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
    // Coba ambil profil dari localStorage / cookie (UserMemory pattern)
    const cached = localStorage.getItem('userProfile');
    if (cached) {
        try { currentUser = JSON.parse(cached); } catch {}
    }

    if (currentUser) {
        hideProfileForm();
        showWelcomeBack(currentUser.nama || currentUser.name);
    }

    // Cek tanggal penutupan galeri dari site_config
    await loadGaleriConfig();
    checkGaleriStatus();

    await Promise.all([loadAdminGallery(), loadUserGallery()]);
    setupAdminFilters();
    setupUserFilters();
    setupUploadForm();

    // Click outside modal tutup
    document.getElementById('upload-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('upload-modal')) closeUploadModal();
    });
    document.getElementById('photo-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('photo-modal')) closePhotoModal();
    });
});


// ════════════════════════════════
// PROFIL USER
// ════════════════════════════════

function hideProfileForm() {
    const row = document.getElementById('identity-row');
    if (row) row.style.display = 'none';
}

function showWelcomeBack(name) {
    const notif = document.createElement('div');
    notif.className = 'fixed bottom-4 right-4 z-50';
    notif.style.cssText = `
        background:var(--bg-card);border:1px solid var(--border-gold);
        padding:16px 20px;font-size:13px;color:var(--text);
        animation:pageIn 0.3s ease;max-width:260px;
    `;
    const p1 = document.createElement('p');
    p1.style.color = 'var(--text-muted)';
    p1.style.fontSize = '11px';
    p1.textContent = 'Selamat datang kembali,';
    const p2 = document.createElement('p');
    p2.style.color = 'var(--gold)';
    p2.style.fontWeight = '500';
    p2.textContent = name + '!';
    notif.appendChild(p1);
    notif.appendChild(p2);
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function saveProfile() {
    // Profile sekarang dikelola oleh UserMemory
    return UserMemory.get();
}


// ════════════════════════════════
// LOAD GALERI
// ════════════════════════════════

async function loadAdminGallery(category = 'all') {
    const grid = document.getElementById('admin-photo-grid');
    if (!grid) return;
    renderSkeleton(grid, 6, 'admin');

    adminPhotos = await fetchFotoAdmin(category);
    currentAdminPage = 1;
    renderAdminGallery();
}

async function loadUserGallery(category = 'all') {
    const grid = document.getElementById('user-photo-grid');
    if (!grid) return;
    renderSkeleton(grid, 4, 'user');

    userPhotos = await fetchFotoUser(category);
    currentUserPage = 1;
    renderUserGallery();
}

function renderSkeleton(grid, count, type) {
    const aspect = type === 'admin' ? 'aspect-ratio:4/3' : 'aspect-ratio:4/3';
    grid.innerHTML = Array(count).fill(`
        <div style="background:var(--bg-card);border:1px solid var(--border);${aspect};animation:shimmer 1.4s infinite;border-radius:2px"></div>
    `).join('');
}


// ════════════════════════════════
// RENDER FOTO ADMIN
// ════════════════════════════════

function renderAdminGallery() {
    const grid = document.getElementById('admin-photo-grid');
    if (!grid) return;

    const toShow = adminPhotos.slice(0, currentAdminPage * PER_PAGE);

    if (!toShow.length) {
        grid.innerHTML = `<div style="grid-column:span 2;text-align:center;padding:48px;color:var(--text-muted);font-size:13px">
            Belum ada foto untuk kategori ini.
        </div>`;
        updateLoadMore('load-more-admin', adminPhotos.length, currentAdminPage);
        return;
    }

    grid.innerHTML = toShow.map((photo, idx) => {
        const isWide = idx === 2;
        const badges = buildBadges(photo.reaksi || {});
        return `
            <div class="photo-item${isWide ? ' photo-wide' : ''}"
                 onclick="openAdminModal(${photo.id})"
                 style="${isWide ? 'grid-column:span 2;aspect-ratio:16/7' : ''}">
                <img src="${photo.photo_url}" alt="${escHtml(photo.title)}"
                     style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
                     loading="lazy"
                     onerror="this.style.display='none'">
                <div class="photo-overlay">
                    <span class="photo-category">${escHtml(photo.category || '')}</span>
                    <span class="photo-title-overlay">${escHtml(photo.title || '')}</span>
                </div>
                <div class="photo-reactions" id="reactions-admin-${photo.id}">${badges}</div>
                <div class="reaction-picker hidden" id="picker-admin-${photo.id}" onclick="event.stopPropagation()">
                    ${EMOJI_LIST.map(e => `<button class="emoji-btn" onclick="handleReaksiAdmin(${photo.id},'${e}')">${e}</button>`).join('')}
                </div>
            </div>`;
    }).join('');

    // Bind long-press / double tap untuk picker
    grid.querySelectorAll('.photo-item').forEach(item => {
        item.addEventListener('contextmenu', e => {
            e.preventDefault();
            const id = item.querySelector('.photo-reactions')?.id.replace('reactions-admin-', '');
            if (id) togglePicker(id, 'admin');
        });
    });

    updateLoadMore('load-more-admin', adminPhotos.length, currentAdminPage);
}


// ════════════════════════════════
// RENDER FOTO USER
// ════════════════════════════════

function renderUserGallery() {
    const grid = document.getElementById('user-photo-grid');
    if (!grid) return;

    const toShow = userPhotos.slice(0, currentUserPage * PER_PAGE);

    if (!toShow.length) {
        grid.innerHTML = `<div style="grid-column:span 2;text-align:center;padding:48px;color:var(--text-muted);font-size:13px">
            Belum ada foto kiriman. Jadilah yang pertama upload!
        </div>`;
        updateLoadMore('load-more-user', userPhotos.length, currentUserPage);
        return;
    }

    grid.innerHTML = toShow.map(photo => {
        const badges  = buildBadges(photo.reaksi || {});
        const isLiked = localStorage.getItem(`pds_gl_${photo.id}`) === '1';
        const time    = formatTimeAgo(photo.created_at);
        return `
            <div class="photo-item" onclick="openUserModal(${photo.id})">
                <img src="${photo.image_url}" alt="${escHtml(photo.title)}"
                     style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
                     loading="lazy"
                     onerror="this.style.display='none'">
                <div class="photo-overlay">
                    <span class="photo-category">${escHtml(photo.category || 'umum')}</span>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
                        <span style="font-size:11px;color:var(--gold)">${escHtml(photo.username || 'Anonim')}</span>
                        <span style="font-size:10px;color:var(--text-muted)">${time}</span>
                    </div>
                </div>
                <div class="photo-reactions" id="reactions-user-${photo.id}">${badges}</div>
                <div class="photo-likes" style="position:absolute;top:8px;right:8px">
                    <span class="reaction-badge" style="cursor:pointer" id="like-badge-${photo.id}"
                          onclick="event.stopPropagation();handleLikePhoto(${photo.id},${photo.likes_count||0})">
                        ${isLiked ? '❤️' : '🤍'} ${photo.likes_count || 0}
                    </span>
                </div>
                <div class="reaction-picker hidden" id="picker-user-${photo.id}" onclick="event.stopPropagation()">
                    ${EMOJI_LIST.map(e => `<button class="emoji-btn" onclick="handleReaksiUser(${photo.id},'${e}')">${e}</button>`).join('')}
                </div>
            </div>`;
    }).join('');

    updateLoadMore('load-more-user', userPhotos.length, currentUserPage);
}

function updateLoadMore(btnId, total, page) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const remaining = total - page * PER_PAGE;
    if (remaining <= 0) { btn.style.display = 'none'; return; }
    btn.style.display  = 'inline-flex';
    btn.textContent    = `Lihat ${remaining} foto lainnya`;
}

window.loadMoreAdmin = function() {
    currentAdminPage++;
    renderAdminGallery();
};
window.loadMoreUser = function() {
    currentUserPage++;
    renderUserGallery();
};


// ════════════════════════════════
// MODAL FOTO ADMIN
// ════════════════════════════════

function openAdminModal(photoId) {
    const photo = adminPhotos.find(p => p.id === photoId);
    if (!photo) return;

    const modal = document.getElementById('photo-modal');
    const body  = document.getElementById('photo-modal-body');
    if (!modal || !body) return;

    body.innerHTML = `
        <div>
            <img src="${photo.photo_url}" alt="${escHtml(photo.title)}"
                 style="width:100%;max-height:70vh;object-fit:contain;background:var(--bg);display:block">
            <div style="padding:20px 0 0">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
                    <div>
                        <h3 style="font-family:'Playfair Display',serif;font-size:20px;color:var(--text);margin-bottom:4px">${escHtml(photo.title)}</h3>
                        <p style="font-size:13px;color:var(--text-muted)">${escHtml(photo.description || 'Dokumentasi resmi sekolah')}</p>
                    </div>
                    <span style="flex-shrink:0;background:var(--bg-raised);border:1px solid var(--border);padding:4px 12px;font-size:10px;color:var(--gold);letter-spacing:1px;text-transform:uppercase">${escHtml(photo.category || '')}</span>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--border)">
                    ${EMOJI_LIST.map(e => {
                        const c = photo.reaksi?.[e] || 0;
                        return `<button onclick="handleReaksiAdminModal(${photo.id},'${e}')"
                            style="background:var(--bg-raised);border:1px solid var(--border);padding:6px 14px;font-size:14px;cursor:pointer;color:var(--text);transition:all 0.15s"
                            onmouseover="this.style.borderColor='var(--border-gold)'"
                            onmouseout="this.style.borderColor='var(--border)'">
                            ${e}${c > 0 ? ` <span style="font-size:11px;color:var(--text-muted)">${c}</span>` : ''}
                        </button>`;
                    }).join('')}
                </div>
            </div>
        </div>`;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

async function handleReaksiAdminModal(photoId, emoji) {
    await handleReaksiAdmin(photoId, emoji);
    openAdminModal(photoId); // refresh modal
}


// ════════════════════════════════
// MODAL FOTO USER (fullscreen + komentar)
// ════════════════════════════════

async function openUserModal(photoId) {
    const modal = document.getElementById('photo-modal');
    const body  = document.getElementById('photo-modal-body');
    if (!modal || !body) return;

    // Loading state
    body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted)">Memuat...</div>`;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    await incrementView(photoId);

    const photo    = userPhotos.find(p => p.id === photoId);
    if (!photo) { closePhotoModal(); return; }

    const comments  = await fetchKomentar(photoId);
    const isLiked   = localStorage.getItem(`pds_gl_${photoId}`) === '1';
    const isMine    = sessionStorage.getItem('_sid') && false; // owner check via session
    const time      = formatTimeAgo(photo.created_at);

    const commentsHTML = comments.length === 0
        ? `<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px 0">Belum ada komentar</p>`
        : comments.map(c => `
            <div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span style="font-size:13px;color:var(--text)">${escHtml(c.username || 'Anonim')}</span>
                    <span style="font-size:11px;color:var(--text-dim)">${formatTimeAgo(c.created_at)}</span>
                </div>
                <p style="font-size:13px;color:var(--text-muted)">${escHtml(c.comment)}</p>
            </div>`).join('');

    body.innerHTML = `
        <div>
            <img src="${photo.image_url}" alt="${escHtml(photo.title)}"
                 style="width:100%;max-height:70vh;object-fit:contain;background:var(--bg);display:block">
            <div style="display:flex;flex-direction:column;gap:16px;padding-top:20px">
                <!-- Info -->
                <div style="display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--border)">
                    <div style="width:44px;height:44px;background:var(--bg-raised);border:1px solid var(--border-gold);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:18px;color:var(--gold)">
                        ${escHtml((photo.username||'A').charAt(0).toUpperCase())}
                    </div>
                    <div>
                        <div style="font-size:14px;color:var(--text)">${escHtml(photo.username || 'Anonim')}</div>
                        <div style="font-size:11px;color:var(--text-dim)">${time}</div>
                    </div>
                </div>

                <div>
                    <h3 style="font-family:'Playfair Display',serif;font-size:18px;color:var(--text);margin-bottom:6px">${escHtml(photo.title)}</h3>
                    <p style="font-size:13px;color:var(--text-muted)">${escHtml(photo.description || '')}</p>
                </div>

                <!-- Stats -->
                <div style="display:flex;gap:20px;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
                    <button id="like-btn-modal" onclick="handleLikePhotoModal(${photoId}, ${photo.likes_count||0})"
                            style="background:none;border:none;font-size:13px;color:${isLiked?'var(--gold)':'var(--text-muted)'};cursor:pointer;display:flex;align-items:center;gap:6px">
                        ${isLiked ? '❤️' : '🤍'} <span id="like-count-modal">${photo.likes_count || 0}</span>
                    </button>
                    <span style="font-size:13px;color:var(--text-muted)">👁 ${photo.views_count || 0}</span>
                    <span style="font-size:13px;color:var(--text-muted)">💬 ${comments.length}</span>
                </div>

                <!-- Aksi -->
                <div style="display:flex;gap:8px">
                    <button onclick="handleLaporFoto(${photoId})"
                            style="flex:1;background:none;border:1px solid var(--border);padding:8px;font-size:12px;color:var(--text-muted);cursor:pointer;font-family:'DM Sans',sans-serif;transition:border-color 0.2s"
                            onmouseover="this.style.borderColor='var(--border-gold)'"
                            onmouseout="this.style.borderColor='var(--border)'">
                        Laporkan
                    </button>
                </div>

                <!-- Komentar -->
                <div>
                    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px">Komentar</p>
                    <div style="max-height:160px;overflow-y:auto;margin-bottom:12px">${commentsHTML}</div>
                    <form onsubmit="submitKomentar(event, ${photoId})" style="display:flex;gap:8px">
                        <input type="text" placeholder="Tulis komentar…"
                               style="flex:1;background:var(--bg-raised);border:1px solid var(--border);padding:8px 12px;font-size:13px;color:var(--text);outline:none;font-family:'DM Sans',sans-serif"
                               onfocus="this.style.borderColor='var(--gold-dim)'"
                               onblur="this.style.borderColor='var(--border)'"
                               required>
                        <button type="submit"
                                style="background:var(--gold);border:none;padding:8px 14px;color:var(--bg);cursor:pointer;font-size:12px;font-family:'DM Sans',sans-serif">
                            Kirim
                        </button>
                    </form>
                </div>
            </div>
        </div>`;
}

async function handleLikePhotoModal(photoId, currentLikes) {
    const result = await likeUserGallery(photoId, currentLikes);
    // Update UI modal
    const btn   = document.getElementById('like-btn-modal');
    const count = document.getElementById('like-count-modal');
    if (btn) {
        btn.style.color = result.liked ? 'var(--gold)' : 'var(--text-muted)';
        btn.innerHTML   = `${result.liked ? '❤️' : '🤍'} <span id="like-count-modal">${result.count ?? currentLikes}</span>`;
    }
    // Update grid card
    const badge = document.getElementById(`like-badge-${photoId}`);
    if (badge) badge.textContent = `${result.liked ? '❤️' : '🤍'} ${result.count ?? currentLikes}`;

    // Update local state
    const p = userPhotos.find(p => p.id === photoId);
    if (p) p.likes_count = result.count ?? currentLikes;
}

async function submitKomentar(e, photoId) {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const text  = input.value.trim();
    if (!text) return;

    const user = currentUser?.nama || currentUser?.name || 'Pengunjung';
    const result = await tambahKomentar(photoId, text, user);

    if (result.ok) {
        input.value = '';
        showToast('💬 Komentar ditambahkan');
        openUserModal(photoId); // refresh modal
    } else {
        showToast('Gagal menambah komentar');
    }
}

async function handleLaporFoto(photoId) {
    const reason = prompt('Alasan melaporkan foto ini:');
    if (!reason) return;
    const result = await laporFoto(photoId, reason);
    showToast(result.ok ? '✅ Laporan terkirim' : '❌ Gagal mengirim laporan');
}

function closePhotoModal() {
    document.getElementById('photo-modal')?.classList.remove('open');
    document.body.style.overflow = 'auto';
}
window.closePhotoModal = closePhotoModal;


// ════════════════════════════════
// REAKSI FOTO
// ════════════════════════════════

function togglePicker(photoId, type) {
    document.querySelectorAll('.reaction-picker').forEach(p => {
        if (p.id !== `picker-${type}-${photoId}`) p.classList.add('hidden');
    });
    document.getElementById(`picker-${type}-${photoId}`)?.classList.toggle('hidden');
}

async function handleReaksiAdmin(id, emoji) {
    await reaktFoto(id, emoji);
    adminPhotos = await fetchFotoAdmin(currentAdminCategory);
    const photo = adminPhotos.find(p => p.id === id);
    if (photo) {
        const el = document.getElementById(`reactions-admin-${id}`);
        if (el) el.innerHTML = buildBadges(photo.reaksi || {});
    }
    document.getElementById(`picker-admin-${id}`)?.classList.add('hidden');
    showToast('Reaksi diberikan!');
}

async function handleReaksiUser(id, emoji) {
    await reaktFoto(id, emoji);
    userPhotos = await fetchFotoUser(currentUserCategory);
    const photo = userPhotos.find(p => p.id === id);
    if (photo) {
        const el = document.getElementById(`reactions-user-${id}`);
        if (el) el.innerHTML = buildBadges(photo.reaksi || {});
    }
    document.getElementById(`picker-user-${id}`)?.classList.add('hidden');
    showToast('Reaksi diberikan!');
}

async function handleLikePhoto(photoId, currentLikes) {
    const result = await likeUserGallery(photoId, currentLikes);
    const badge  = document.getElementById(`like-badge-${photoId}`);
    if (badge) badge.textContent = `${result.liked ? '❤️' : '🤍'} ${result.count ?? currentLikes}`;
    const p = userPhotos.find(p => p.id === photoId);
    if (p) p.likes_count = result.count ?? currentLikes;
}

function buildBadges(reaksi) {
    return Object.entries(reaksi)
        .filter(([,c]) => c > 0)
        .map(([e,c]) => `<span class="reaction-badge">${e} ${c}</span>`)
        .join('');
}


// ════════════════════════════════
// UPLOAD
// ════════════════════════════════

function setupUploadForm() {
    const input = document.getElementById('upload-file');
    if (!input) return;

    // Pasang change listener di input file — ini yang paling penting
    input.addEventListener('change', () => handleFileSelect(input));

    // Drag & drop ke upload-trigger kalau ada
    const trigger = document.getElementById('upload-trigger');
    if (trigger) {
        trigger.addEventListener('dragover', e => { e.preventDefault(); trigger.style.borderColor = 'var(--gold)'; });
        trigger.addEventListener('dragleave', () => { trigger.style.borderColor = ''; });
        trigger.addEventListener('drop', e => {
            e.preventDefault();
            trigger.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith('image/')) {
                // Buka modal dulu, lalu set file
                openUploadModal();
                setTimeout(() => {
                    const inp = document.getElementById('upload-file');
                    if (inp) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        inp.files = dt.files;
                        handleFileSelect(inp);
                    }
                }, 100);
            }
        });
    }
}

function handleFileSelect(input) {
    const file    = input.files[0];
    const preview = document.getElementById('file-preview');
    const label   = document.getElementById('file-label');
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { showToast('❌ Ukuran maksimal 5MB'); input.value = ''; return; }
    if (!file.type.startsWith('image/')) { showToast('❌ Hanya file gambar'); input.value = ''; return; }

    const reader = new FileReader();
    reader.onload = e => {
        if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
        if (label)   label.textContent = file.name;
    };
    reader.readAsDataURL(file);
}

function toggleJurusanField() {
    const role = document.getElementById('upload-role')?.value;
    const row  = document.getElementById('jurusan-row');
    if (row) row.style.display = role === 'Siswa' ? 'flex' : 'none';
}

function closeUploadModal() {
    document.getElementById('upload-modal')?.classList.remove('open');
    document.getElementById('upload-form')?.reset();
    const preview = document.getElementById('file-preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    document.getElementById('file-label') && (document.getElementById('file-label').textContent = 'Pilih foto…');
    toggleJurusanField();
}
window.closeUploadModal = closeUploadModal;

async function submitUpload() {
    const title    = document.getElementById('upload-title')?.value.trim();
    const nama = null; const role = null; const jurusan = null; // handled by UserMemory
    const desc     = document.getElementById('upload-desc')?.value.trim() || '';
    const category = document.getElementById('upload-category')?.value || 'umum';
    const fileInput = document.getElementById('upload-file');
    const file     = fileInput?.files[0];

    // Cek apakah upload masih aktif
    if (_galeriClosed) {
        showToast('📷 Masa upload foto sudah berakhir');
        closeUploadModal();
        return;
    }

    if (!title) { showToast('Mohon isi judul foto'); return; }
    if (!file)  { showToast('Pilih foto terlebih dahulu'); return; }

    // Ambil profil dari UserMemory
    const profile = UserMemory.get();
    const uploaderName    = profile?.name    || nama || 'Anonim';
    const uploaderRole    = profile?.role    || role || 'Anonim';
    const uploaderJurusan = profile?.jurusan || jurusan || null;

    const btn = document.querySelector('#upload-modal .btn-primary');
    if (btn) { btn.textContent = 'Mengunggah…'; btn.disabled = true; }

    const result = await uploadFoto(file, {
        uploader:    uploaderName,
        role:        uploaderRole,
        jurusan:     uploaderJurusan,
        title,
        description: desc,
        category,
    });

    if (btn) { btn.textContent = 'Upload Foto'; btn.disabled = false; }

    if (result.ok) {
        closeUploadModal();
        showToast('✅ Foto terkirim! Menunggu persetujuan admin.');
        loadUserGallery(currentUserCategory);
    } else {
        showToast(result.message || '❌ Gagal upload');
    }
}
window.submitUpload = submitUpload;


// ════════════════════════════════
// FILTER
// ════════════════════════════════

function setupAdminFilters() {
    document.querySelectorAll('.admin-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentAdminCategory = this.dataset.category;
            currentAdminPage     = 1;
            loadAdminGallery(currentAdminCategory);
        });
    });
}

function setupUserFilters() {
    document.querySelectorAll('.user-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.user-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentUserCategory = this.dataset.category;
            currentUserPage     = 1;
            loadUserGallery(currentUserCategory);
        });
    });
}


// ════════════════════════════════
// HELPERS
// ════════════════════════════════

function buildBadges(reaksi) {
    return Object.entries(reaksi)
        .filter(([,c]) => c > 0)
        .map(([e,c]) => `<span class="reaction-badge">${e} ${c}</span>`)
        .join('');
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTimeAgo(iso) {
    if (!iso) return '';
    const diff  = Date.now() - new Date(iso).getTime();
    const m     = Math.floor(diff / 60000);
    if (m < 1)  return 'Baru saja';
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    const d = Math.floor(h / 24);
    if (d < 7)  return `${d} hari lalu`;
    const w = Math.floor(d / 7);
    if (w < 4)  return `${w} minggu lalu`;
    return `${Math.floor(d / 30)} bulan lalu`;
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3500);
}


// ════════════════════════════════════════════
// SISTEM PENUTUPAN GALERI
// ════════════════════════════════════════════

async function loadGaleriConfig() {
    try {
        const db = getSupabaseClient();
        const { data } = await db
            .from('site_config')
            .select('value')
            .eq('key', 'gallery_close_date')
            .maybeSingle();

        if (data?.value) {
            _galeriCloseDate = new Date(data.value);
            _galeriClosed    = new Date() > _galeriCloseDate;
        }
    } catch { /* silent — anggap aktif */ }
}

function checkGaleriStatus() {
    if (!_galeriClosed) return;

    // Sembunyikan upload trigger
    const trigger = document.getElementById('upload-trigger');
    if (trigger) {
        trigger.style.display = 'none';
    }

    // Tampilkan banner di atas section kiriman
    const userGrid = document.getElementById('user-photo-grid');
    if (userGrid) {
        const banner = document.createElement('div');
        banner.style.cssText = `
            grid-column: span 2;
            background: var(--bg-card);
            border: 1px solid var(--border);
            padding: 32px 24px;
            text-align: center;
            margin-bottom: 8px;
        `;
        banner.innerHTML = `
            <div style="font-size:24px;margin-bottom:12px">📷</div>
            <p style="font-family:'Playfair Display',serif;font-size:16px;font-style:italic;
                      color:var(--text);margin-bottom:6px">Upload Foto Ditutup</p>
            <p style="font-size:12px;color:var(--text-muted)">
                Masa pengiriman foto telah berakhir.
                ${_galeriCloseDate
                    ? `Ditutup pada ${_galeriCloseDate.toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}.`
                    : ''}
            </p>
        `;
        userGrid.insertAdjacentElement('beforebegin', banner);
    }
}
