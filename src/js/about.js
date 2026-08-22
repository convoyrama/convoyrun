// Versión leída en vivo vía la API de Tauri, no hardcodeada. Ahora el About es una pestaña, no un modal.
export function initAbout() {
    const versionEl = document.getElementById('about-version');
    if (versionEl) {
        window.__TAURI__.app.getVersion().then(v => { versionEl.textContent = v; }).catch(() => {});
    }
}
