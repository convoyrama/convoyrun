// Versión leída en vivo vía la API de Tauri, no hardcodeada.
export function initAbout() {
    const overlay = document.getElementById('about-overlay');
    const openBtn = document.getElementById('about-open');
    const closeBtn = document.getElementById('about-close');
    const versionEl = document.getElementById('about-version');

    window.__TAURI__.app.getVersion().then(v => { versionEl.textContent = v; }).catch(() => {});

    openBtn.addEventListener('click', () => overlay.classList.add('open'));
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('open'); });
}
