// Aísla todo lo que toca la API de Tauri en funciones chicas — así el resto
// de la app (main.js, canvas.js) no necesita saber que corre en un webview
// de Tauri y no en un navegador cualquiera.
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

// Reencodea el PNG con máxima compresión sin pérdida del lado de Rust.
// Recibe/devuelve ArrayBuffer para que quien llame no tenga que pensar en
// el array de números que usa el IPC por debajo.
export async function optimizePng(arrayBuffer) {
    const optimized = await tauri().core.invoke('optimize_png', { bytes: Array.from(new Uint8Array(arrayBuffer)) });
    return new Uint8Array(optimized).buffer;
}
