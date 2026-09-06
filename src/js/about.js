// Versión leída en vivo vía la API de Tauri, no hardcodeada. Ahora el About es una pestaña, no un modal.
export function initAbout() {
    const versionEl = document.getElementById('about-version');
    const footerVersionEl = document.getElementById('footer-version');
    const applyVersion = (v) => {
        const version = v || 'dev';
        if (versionEl) versionEl.textContent = version;
        if (footerVersionEl) footerVersionEl.textContent = version;
    };
    if (!versionEl && !footerVersionEl) return;
    if (!window.__TAURI__?.app?.getVersion) {
        applyVersion('dev');
        return;
    }
    window.__TAURI__.app.getVersion().then(applyVersion).catch(() => applyVersion('dev'));
}
