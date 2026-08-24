// Versión leída en vivo vía la API de Tauri, no hardcodeada. Ahora el About es una pestaña, no un modal.
export function initAbout() {
    const versionEl = document.getElementById('about-version');
    if (!versionEl) return;
    if (!window.__TAURI__?.app) { versionEl.textContent = 'dev'; return; }
    window.__TAURI__.app.getVersion().then(v => { versionEl.textContent = v; }).catch(() => { versionEl.textContent = 'dev'; });
}
