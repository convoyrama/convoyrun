// Aísla la API de Tauri: el resto de la app no sabe que corre en un webview.
const tauri = () => window.__TAURI__;

export async function saveFile(bytes, suggestedName, filters = [{ name: 'PNG Image', extensions: ['png'] }]) {
    const path = await tauri().dialog.save({ defaultPath: suggestedName, filters });
    if (!path) return null; // canceló el diálogo
    await tauri().core.invoke('save_file', { path, contents: Array.from(bytes) });
    return path;
}

export async function copyToClipboard(text) {
    await tauri().clipboardManager.writeText(text);
}

// Reencodea el PNG (máxima compresión, sin pérdida) del lado de Rust.
export async function optimizePng(arrayBuffer) {
    const optimized = await tauri().core.invoke('optimize_png', { bytes: Array.from(new Uint8Array(arrayBuffer)) });
    return new Uint8Array(optimized).buffer;
}
