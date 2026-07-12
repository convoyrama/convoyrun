use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;

// Escribe el archivo generado (el flyer) en la ruta que el usuario eligió
// con el diálogo nativo del plugin dialog.
#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

// Reencodea el PNG con compresión máxima sin pérdida. El encoder del canvas
// usa compresión por defecto y deja peso arriba de la mesa en flyers con
// fotos de mapa — esto lo baja antes de que el lado JS incruste el chunk
// iTXt, para que sea más fácil quedar bajo el límite de subida de TMP.
#[tauri::command]
fn optimize_png(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let mut out = Vec::new();
    let encoder = PngEncoder::new_with_quality(&mut out, CompressionType::Best, FilterType::Adaptive);
    encoder
        .write_image(&rgba, rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![save_file, optimize_png])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
