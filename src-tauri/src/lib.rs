use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, AtomicBool, Ordering};
use tauri::{Manager, State, Emitter};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tokio::sync::RwLock;

mod p2p;
mod convoy;
use p2p::{NodeStatus, P2pState, GossipMessage, UserConfig};
use convoy::{ConvoyRecord, ConvoyStore, EventData, FlyerData, Schedule, VoteRecord, ChannelRecord, ChannelStore, BlacklistRecord, BlacklistStore, TrustlistRecord, TrustlistStore, KnownNicksStore, SYSTEM_CHANNELS};

/// Upload de imagen a Catbox.moe (multipart desde Rust, evita CORS del webview)
/// Soporta PNG, JPEG, WebP, GIF
#[tauri::command]
async fn upload_to_catbox(bytes: Vec<u8>) -> Result<String, String> {
    // Límite de tamaño (10 MB)
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(format!("FILE_TOO_LARGE:{:.1}", bytes.len() as f64 / (1024.0 * 1024.0)));
    }

    // Detectar tipo de imagen por magic bytes
    let (filename, mime) = detect_image_type(&bytes)?;

    let client = reqwest::Client::builder()
        .user_agent("ConvoyRun/0.3.6")
        .timeout(std::time::Duration::from_secs(60))
        .no_proxy()
        .build()
        .map_err(|e| format!("CLIENT_ERROR:{}", e))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|e| format!("PART_ERROR:{}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .part("fileToUpload", part);

    let resp = client.post("https://catbox.moe/user/api.php")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("UPLOAD_ERROR:{}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP_ERROR:{}", status.as_u16()));
    }

    let url = resp.text().await.map_err(|e| format!("READ_ERROR:{}", e))?;
    let url = url.trim().to_string();

    if !url.starts_with("https://") {
        return Err(format!("INVALID_RESPONSE:{}", &url[..url.len().min(50)]));
    }

    Ok(url)
}

/// Detecta el tipo de imagen por magic bytes y retorna (filename, mime)
fn detect_image_type(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.len() < 12 {
        return Err("INVALID_IMAGE: archivo demasiado pequeño".to_string());
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Ok(("flyer.png", "image/png"));
    }

    // JPEG: FF D8 FF
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok(("flyer.jpg", "image/jpeg"));
    }

    // WebP: 52 49 46 46 ... 57 45 42 50
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Ok(("flyer.webp", "image/webp"));
    }

    // GIF: 47 49 46 38 (GIF87a o GIF89a)
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok(("flyer.gif", "image/gif"));
    }

    Err("INVALID_IMAGE: formato no soportado (use PNG, JPG, WebP o GIF)".to_string())
}

/// Master public key para verificar keys de canales Patreon
/// Esta es la clave PÚBLICA ed25519 (32 bytes) derivada de la master private key.
const MASTER_PUBLIC_KEY: [u8; 32] = [
    0xbe, 0x33, 0x70, 0xf6, 0x64, 0x18, 0x3a, 0xd7,
    0x71, 0xe0, 0x4d, 0xc8, 0xdd, 0xe8, 0x9f, 0x4b,
    0xed, 0x3e, 0x51, 0x16, 0xc8, 0x6c, 0xba, 0xc1,
    0x32, 0xed, 0x40, 0xa5, 0x40, 0x02, 0x26, 0xd0,
];

/// Estado global de la app — stores en memoria con Arc<RwLock> para evitar TOCTOU
struct AppState {
    p2p: RwLock<Option<Arc<P2pState>>>,
    data_dir: PathBuf,
    convoy_store: Arc<RwLock<ConvoyStore>>,
    channel_store: Arc<RwLock<ChannelStore>>,
    blacklist_store: Arc<RwLock<BlacklistStore>>,
    trustlist_store: Arc<RwLock<TrustlistStore>>,
    known_nicks: Arc<RwLock<KnownNicksStore>>,
    config: Arc<RwLock<UserConfig>>,
}

/// Helper: flush convoy store a disco (llamar con lock ya adquirido)
fn flush_convoy_store(store: &ConvoyStore, data_dir: &Path) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save convoy store: {}", e);
    }
}

/// Helper: flush channel store a disco
fn flush_channel_store(store: &ChannelStore, data_dir: &Path) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save channel store: {}", e);
    }
}

/// Helper: flush blacklist store a disco
fn flush_blacklist_store(store: &BlacklistStore, data_dir: &Path) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save blacklist store: {}", e);
    }
}

/// Helper: flush trustlist store a disco
fn flush_trustlist_store(store: &TrustlistStore, data_dir: &Path) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save trustlist store: {}", e);
    }
}

/// Helper: load config from shared cache (avoid disk I/O on every command)
async fn load_config_cached(config: &Arc<RwLock<UserConfig>>) -> UserConfig {
    config.read().await.clone()
}

/// Helper: save config to shared cache + disk
async fn save_config_cached(data_dir: &Path, config: &Arc<RwLock<UserConfig>>, new_config: &UserConfig) -> Result<(), String> {
    p2p::save_config(data_dir, new_config).map_err(|e| e.to_string())?;
    *config.write().await = new_config.clone();
    Ok(())
}

/// Procesa mensajes de gossip recibidos de otros nodos
async fn process_gossip_receiver(
    mut receiver: distributed_topic_tracker::GossipReceiver,
    gossip_sender: distributed_topic_tracker::GossipSender,
    data_dir: PathBuf,
    config_cache: Arc<RwLock<UserConfig>>,
    app_handle: tauri::AppHandle,
    convoy_store: Arc<RwLock<ConvoyStore>>,
    channel_store: Arc<RwLock<ChannelStore>>,
    blacklist_store: Arc<RwLock<BlacklistStore>>,
    trustlist_store: Arc<RwLock<TrustlistStore>>,
    known_nicks: Arc<RwLock<KnownNicksStore>>,
    neighbor_count: Arc<AtomicUsize>,
) {
    eprintln!("[P2P] Gossip receiver started");
    let mut seen: HashSet<String> = HashSet::new();
    const MAX_SEEN: usize = 10_000;
    loop {
        match receiver.next().await {
            Ok(event) => {
                match event {
                    iroh_gossip::api::Event::NeighborUp(ref peer) => {
                        let count = neighbor_count.fetch_add(1, Ordering::SeqCst) + 1;
                        eprintln!("[P2P] NeighborUp: {} (neighbors: {})", peer, count);

                        // Re-broadcast all known events to new peer
                        let store = convoy_store.read().await;
                        let event_count = store.convoys.len();
                        if event_count > 0 {
                            eprintln!("[P2P] Re-broadcasting {} events to new peer", event_count);
                            for record in store.convoys.values() {
                                if let Ok(json) = serde_json::to_string(record) {
                                    if let Err(e) = P2pState::publish_convoy_gossip(&gossip_sender, &json).await {
                                        eprintln!("[P2P] Failed to re-broadcast event: {}", e);
                                    }
                                }
                            }
                        }

                        continue;
                    }
                    iroh_gossip::api::Event::NeighborDown(ref peer) => {
                        // Prevenir underflow del contador
                        neighbor_count.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                            if n > 0 { Some(n - 1) } else { Some(0) }
                        }).ok();
                        let count = neighbor_count.load(Ordering::SeqCst);
                        eprintln!("[P2P] NeighborDown: {} (neighbors: {})", peer, count);
                        continue;
                    }
                    iroh_gossip::api::Event::Received(message) => {
                eprintln!("[P2P] Received gossip message: {} bytes, sender={}", message.content.len(), message.delivered_from);
                if message.content.len() > 1024 * 1024 {
                    eprintln!("[P2P] Gossip message too large ({} bytes), ignoring", message.content.len());
                    continue;
                }
                if let Ok(gossip_msg) = serde_json::from_slice::<GossipMessage>(&message.content) {
                    // Deduplicación: generar key única por mensaje
                    let dedup_key = match &gossip_msg {
                        GossipMessage::Convoy { data } => {
                            serde_json::from_str::<ConvoyRecord>(data).ok().map(|r| format!("convoy:{}", r.id))
                        }
                        GossipMessage::Vote { data } => {
                            serde_json::from_str::<VoteRecord>(data).ok().map(|r| format!("vote:{}:{}", r.convoy_id, r.voter_peer_id))
                        }
                        GossipMessage::DeleteConvoy { convoy_id, peer_id, .. } => {
                            Some(format!("delete:{}:{}", convoy_id, peer_id))
                        }
                        GossipMessage::Channel { data } => {
                            serde_json::from_str::<ChannelRecord>(data).ok().map(|r| format!("channel:{}", r.name))
                        }
                        GossipMessage::Blacklist { data } => {
                            serde_json::from_str::<BlacklistRecord>(data).ok().map(|r| format!("blacklist:{}:{}", r.author_peer_id, r.updated_at))
                        }
                        GossipMessage::Trustlist { data } => {
                            serde_json::from_str::<TrustlistRecord>(data).ok().map(|r| format!("trustlist:{}:{}", r.author_peer_id, r.updated_at))
                        }
                    };
                    if let Some(ref key) = dedup_key {
                        if seen.contains(key) {
                            continue;
                        }
                        seen.insert(key.clone());
                        // Remover la mitad más antigua cuando se llena (no clear total)
                        if seen.len() > MAX_SEEN {
                            let to_remove: Vec<_> = seen.iter().take(MAX_SEEN / 2).cloned().collect();
                            for k in to_remove { seen.remove(&k); }
                        }
                    }

                    // Verificar si el autor está bloqueado
                    let author_peer_id = match &gossip_msg {
                        GossipMessage::Convoy { data } => {
                            serde_json::from_str::<ConvoyRecord>(data).ok().map(|r| r.peer_id)
                        }
                        GossipMessage::Vote { data } => {
                            serde_json::from_str::<VoteRecord>(data).ok().map(|r| r.voter_peer_id)
                        }
                        GossipMessage::DeleteConvoy { peer_id, .. } => Some(peer_id.clone()),
                        GossipMessage::Channel { data } => {
                            serde_json::from_str::<ChannelRecord>(data).ok().map(|r| r.creator_peer_id)
                        }
                        GossipMessage::Blacklist { data } => {
                            serde_json::from_str::<BlacklistRecord>(data).ok().map(|r| r.author_peer_id)
                        }
                        GossipMessage::Trustlist { data } => {
                            serde_json::from_str::<TrustlistRecord>(data).ok().map(|r| r.author_peer_id)
                        }
                    };
                    if let Some(ref pid) = author_peer_id {
                        let config = config_cache.read().await;
                        if config.blocked_authors.contains(pid) {
                            eprintln!("[P2P] Blocked author {}, ignoring message", pid);
                            continue;
                        }
                    }
                    match gossip_msg {
                        GossipMessage::Convoy { data } => {
                            eprintln!("[P2P] Received Convoy gossip: {} bytes", data.len());
                            if let Ok(record) = serde_json::from_str::<ConvoyRecord>(&data) {
                                // Validar longitud de campos para prevenir abuso
                                if record.nickname.len() > 64 || record.event.name.len() > 200
                                    || record.event.description.len() > 5000 || record.event.server.len() > 100 {
                                    eprintln!("[P2P] Convoy fields too large, ignoring");
                                    continue;
                                }
                                // Validar expiración antes de almacenar
                                let now = chrono::Utc::now().timestamp();
                                if !record.is_retained(now) || !record.is_within_publish_window(now) {
                                    eprintln!("[P2P] Convoy {} rejected: is_retained={}, is_within_publish_window={}, meeting_ts={}, now={}",
                                        record.id, record.is_retained(now), record.is_within_publish_window(now),
                                        record.schedule.meeting_timestamp, now);
                                    continue;
                                }
                                match record.verify() {
                                    Ok(true) => {
                                        eprintln!("[P2P] Convoy {} verified OK from peer {}", record.id, record.peer_id);
                                        // Almacenar nick conocido
                                        if !record.nickname.is_empty() {
                                            let mut nicks = known_nicks.write().await;
                                            nicks.update_nick(record.peer_id.clone(), record.nickname.clone());
                                            nicks.save(&data_dir);
                                        }
                                        let mut store = convoy_store.write().await;
                                        store.upsert_convoy(record);
                                        flush_convoy_store(&store, &data_dir);
                                        let _ = app_handle.emit("convoy-new", serde_json::Value::Null);
                                    }
                                    Ok(false) => {
                                        eprintln!("[P2P] Received convoy with invalid signature, ignoring");
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify convoy signature: {}", e);
                                    }
                                }
                            } else {
                                eprintln!("[P2P] Failed to deserialize ConvoyRecord from gossip ({} bytes), data preview: {:.200}",
                                    data.len(), data);
                            }
                        }
                        GossipMessage::Vote { data } => {
                            if let Ok(record) = serde_json::from_str::<VoteRecord>(&data) {
                                match record.verify() {
                                    Ok(true) => {}
                                    Ok(false) => {
                                        eprintln!("[P2P] Received vote with invalid signature, ignoring");
                                        continue;
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify vote signature: {}", e);
                                        continue;
                                    }
                                }
                                if record.vote != 1 && record.vote != -1 {
                                    eprintln!("[P2P] Received vote with invalid value: {}", record.vote);
                                    continue;
                                }
                                let mut store = convoy_store.write().await;
                                store.upsert_vote(record);
                                flush_convoy_store(&store, &data_dir);
                                let _ = app_handle.emit("vote-new", serde_json::Value::Null);
                            }
                        }
                        GossipMessage::DeleteConvoy { convoy_id, peer_id, signature } => {
                            // Verificar firma del delete (soporta hex y base64)
                            use ed25519_dalek::{Verifier, VerifyingKey};
                            let sig_valid = (|| -> anyhow::Result<bool> {
                                let key_array = convoy::decode_peer_id_bytes(&peer_id)?;
                                let verifying_key = VerifyingKey::from_bytes(&key_array)?;
                                let sig_bytes = base64::Engine::decode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &signature,
                                )?;
                                if sig_bytes.len() != 64 { return Ok(false); }
                                let mut sig_array = [0u8; 64];
                                sig_array.copy_from_slice(&sig_bytes);
                                let sig = ed25519_dalek::Signature::from_bytes(&sig_array);
                                let msg = format!("{}:{}", convoy_id, peer_id);
                                Ok(verifying_key.verify(msg.as_bytes(), &sig).is_ok())
                            })();
                            match sig_valid {
                                Ok(true) => {}
                                _ => {
                                    eprintln!("[P2P] Received delete with invalid signature, ignoring");
                                    continue;
                                }
                            }
                            let mut store = convoy_store.write().await;
                            if let Some(convoy) = store.convoys.get(&convoy_id) {
                                if convoy.peer_id == peer_id {
                                    store.delete_convoy(&convoy_id);
                                    flush_convoy_store(&store, &data_dir);
                                    eprintln!("[P2P] Convoy deleted by author: {}", convoy_id);
                                }
                            }
                        }
                        GossipMessage::Channel { data } => {
                            if let Ok(channel) = serde_json::from_str::<ChannelRecord>(&data) {
                                let mut store = channel_store.write().await;
                                // Solo actualizar canales ya conocidos (no crear nuevos desde gossip)
                                if store.channels.contains_key(&channel.name) {
                                    store.channels.insert(channel.name.clone(), channel);
                                    flush_channel_store(&store, &data_dir);
                                }
                            }
                        }
                        GossipMessage::Blacklist { data } => {
                            if let Ok(record) = serde_json::from_str::<BlacklistRecord>(&data) {
                                match record.verify() {
                                    Ok(true) => {}
                                    Ok(false) => {
                                        eprintln!("[P2P] Received blacklist with invalid signature, ignoring");
                                        continue;
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify blacklist signature: {}", e);
                                        continue;
                                    }
                                }
                                let mut store = blacklist_store.write().await;
                                store.upsert(record);
                                flush_blacklist_store(&store, &data_dir);
                            }
                        }
                        GossipMessage::Trustlist { data } => {
                            if let Ok(record) = serde_json::from_str::<TrustlistRecord>(&data) {
                                match record.verify() {
                                    Ok(true) => {}
                                    Ok(false) => {
                                        eprintln!("[P2P] Received trustlist with invalid signature, ignoring");
                                        continue;
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify trustlist signature: {}", e);
                                        continue;
                                    }
                                }
                                let mut store = trustlist_store.write().await;
                                store.upsert(record);
                                flush_trustlist_store(&store, &data_dir);
                            }
                        }
                    }
                } else {
                    eprintln!("[P2P] Received malformed gossip message ({} bytes), ignoring", message.content.len());
                }
                    }
                    iroh_gossip::api::Event::Lagged => {
                        eprintln!("[P2P] Gossip receiver lagged, some messages may have been missed");
                    }
                }
            }
            Err(e) => {
                let err_str = format!("{}", e);
                if err_str.contains("Closed") {
                    eprintln!("[P2P] Gossip receiver closed");
                    break;
                }
                eprintln!("[P2P] Gossip receiver error: {}", e);
            }
        }
    }
}

// --- Comandos existentes ---

#[tauri::command]
async fn save_file(state: State<'_, AppState>, path: String, contents: Vec<u8>) -> Result<(), String> {
    if path.contains('\0') || path.len() > 4096 {
        return Err("Invalid file path".to_string());
    }
    if path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    // If path is absolute (from dialog), use it directly; otherwise join with data_dir
    let full_path = if Path::new(&path).is_absolute() {
        let p = PathBuf::from(&path);
        // Bloquear escritura en ubicaciones sensibles del sistema
        let path_str = p.to_string_lossy().to_lowercase();
        let blocked = ["/etc/", "/proc/", "/sys/", "/dev/", "/boot/", "/root/",
                       "\\windows\\", "\\programdata\\", "program files"];
        for blocked_path in &blocked {
            if path_str.contains(blocked_path) {
                return Err("Cannot write to system directories".to_string());
            }
        }
        p
    } else {
        state.data_dir.join(&path)
    };
    tokio::fs::write(&full_path, contents).await.map_err(|e| e.to_string())
}

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

// --- Comandos P2P ---

#[tauri::command]
async fn p2p_init(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<NodeStatus, String> {
    let mut p2p_guard = state.p2p.write().await;

    if let Some(p2p) = p2p_guard.as_ref() {
        let config = load_config_cached(&state.config).await;
        return Ok(p2p.status(config.nickname));
    }

    let mut p2p = P2pState::init(&state.data_dir)
        .await
        .map_err(|e| format!("Failed to initialize P2P: {}", e))?;

    match p2p.join_topic().await {
        Ok((sender, receiver)) => {
            let gossip_sender_for_receiver = sender.clone();
            p2p.gossip_sender = Some(sender);
            let data_dir = state.data_dir.clone();
            let cs = state.convoy_store.clone();
            let chs = state.channel_store.clone();
            let bls = state.blacklist_store.clone();
            let tls = state.trustlist_store.clone();
            let kn = state.known_nicks.clone();
            let nc = p2p.neighbor_count.clone();
            let cc = state.config.clone();
            let ah = app.clone();
            tokio::spawn(async move {
                process_gossip_receiver(receiver, gossip_sender_for_receiver, data_dir, cc, ah, cs, chs, bls, tls, kn, nc).await;
            });
            eprintln!("[P2P] Joined gossip topic successfully");
        }
        Err(e) => {
            eprintln!("[P2P] Failed to join topic: {}", e);
        }
    }

    let config = load_config_cached(&state.config).await;
    let status = p2p.status(config.nickname);

    *p2p_guard = Some(Arc::new(p2p));

    Ok(status)
}

#[tauri::command]
async fn p2p_restart(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<NodeStatus, String> {
    // Drop old P2P state
    {
        let mut p2p_guard = state.p2p.write().await;
        *p2p_guard = None;
    }
    // Small delay to let old connections close
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    // Reinitialize
    p2p_init(state, app).await
}

#[tauri::command]
async fn p2p_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let p2p_guard = state.p2p.read().await;

    match p2p_guard.as_ref() {
        Some(p2p) => {
            let config = load_config_cached(&state.config).await;
            Ok(p2p.status(config.nickname))
        }
        None => Ok(NodeStatus {
            mode: "local".to_string(),
            peer_id: String::new(),
            nickname: None,
            online: false,
        }),
    }
}

// --- Comandos de backup ---

#[tauri::command]
async fn export_identity(
    state: State<'_, AppState>,
    output_path: String,
    password: Option<String>,
) -> Result<(), String> {
    let key_bytes = {
        let p2p_guard = state.p2p.read().await;
        match p2p_guard.as_ref() {
            Some(p2p) => p2p.secret_key.to_bytes().to_vec(),
            None => {
                // Fallback: read from disk if P2P not initialized
                let identity_path = state.data_dir.join("node_identity.key");
                std::fs::read(&identity_path).map_err(|e| format!("Failed to read identity: {}", e))?
            }
        }
    };
    p2p::export_identity_with_key(
        &key_bytes,
        &state.data_dir,
        &PathBuf::from(output_path),
        password.as_deref(),
    )
    .map_err(|e| format!("Failed to export identity: {}", e))
}

#[tauri::command]
async fn import_identity(
    state: State<'_, AppState>,
    input_path: String,
    password: Option<String>,
) -> Result<(), String> {
    p2p::import_identity(
        &state.data_dir,
        &PathBuf::from(input_path),
        password.as_deref(),
    )
    .map_err(|e| format!("Failed to import identity: {}", e))
}

// --- Comandos de configuración ---

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<UserConfig, String> {
    Ok(load_config_cached(&state.config).await)
}

#[tauri::command]
async fn set_config(
    state: State<'_, AppState>,
    config: UserConfig,
) -> Result<(), String> {
    save_config_cached(&state.data_dir, &state.config, &config).await
}

// --- Comandos de moderación comunitaria ---

#[tauri::command]
async fn block_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    if config.blocked_authors.insert(peer_id) {
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn unblock_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    config.blocked_authors.remove(&peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Comandos de blacklists públicas ---

#[tauri::command]
async fn publish_blacklist(state: State<'_, AppState>) -> Result<(), String> {
    let config = load_config_cached(&state.config).await;
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut record = BlacklistRecord {
        schema: "convoyrun/blacklist/v1".to_string(),
        author_peer_id: p2p.peer_id(),
        blocked: config.blocked_authors.iter().cloned().collect(),
        updated_at: chrono::Utc::now().timestamp(),
        signature: String::new(),
    };

    if let Err(e) = record.sign(&p2p.secret_key) {
        eprintln!("[P2P] Failed to sign blacklist: {}", e);
        return Err(format!("Failed to sign blacklist: {}", e));
    }

    let bl_json = serde_json::to_string(&record).map_err(|e| e.to_string())?;

    if let Some(sender) = &p2p.gossip_sender {
        if let Err(e) = P2pState::publish_blacklist_gossip(sender, &bl_json).await {
            eprintln!("[P2P] Failed to publish blacklist via gossip: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn import_blacklist(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    if !config.followed_blacklists.contains(&peer_id) {
        config.followed_blacklists.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_following_blacklist(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    config.followed_blacklists.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_public_blacklists(state: State<'_, AppState>) -> Result<Vec<BlacklistRecord>, String> {
    let store = state.blacklist_store.read().await;
    Ok(store.blacklists.values().cloned().collect())
}

// --- Comandos de trustlists públicas ---

#[tauri::command]
async fn publish_trustlist(state: State<'_, AppState>) -> Result<(), String> {
    let config = load_config_cached(&state.config).await;
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut record = TrustlistRecord {
        schema: "convoyrun/trustlist/v1".to_string(),
        author_peer_id: p2p.peer_id(),
        trusted: config.trusted_peers.iter().cloned().collect(),
        updated_at: chrono::Utc::now().timestamp(),
        signature: String::new(),
    };

    if let Err(e) = record.sign(&p2p.secret_key) {
        eprintln!("[P2P] Failed to sign trustlist: {}", e);
        return Err(format!("Failed to sign trustlist: {}", e));
    }

    let tl_json = serde_json::to_string(&record).map_err(|e| e.to_string())?;

    if let Some(sender) = &p2p.gossip_sender {
        if let Err(e) = P2pState::publish_trustlist_gossip(sender, &tl_json).await {
            eprintln!("[P2P] Failed to publish trustlist via gossip: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn import_trustlist(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    if !config.followed_trustlists.contains(&peer_id) {
        config.followed_trustlists.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_following_trustlist(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = state.config.write().await;
    config.followed_trustlists.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_public_trustlists(state: State<'_, AppState>) -> Result<Vec<TrustlistRecord>, String> {
    let store = state.trustlist_store.read().await;
    Ok(store.trustlists.values().cloned().collect())
}

// --- Comandos de discovery ---

#[tauri::command]
async fn get_discovery_state(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let p2p_guard = state.p2p.read().await;
    match p2p_guard.as_ref() {
        Some(p2p) => {
            let nc = p2p.neighbor_count.load(Ordering::Relaxed);
            Ok(serde_json::json!({
                "online": true,
                "neighborCount": nc,
                "dhtStatus": "active",
            }))
        }
        None => Ok(serde_json::json!({
            "online": false,
            "neighborCount": 0,
            "dhtStatus": "inactive",
        })),
    }
}

#[tauri::command]
async fn get_author_profile(
    state: State<'_, AppState>,
    peer_id: String,
) -> Result<serde_json::Value, String> {
    let store = state.convoy_store.read().await;
    let config = load_config_cached(&state.config).await;

    let convoys: Vec<&ConvoyRecord> = store.convoys.values().filter(|c| c.peer_id == peer_id).collect();
    let reputation: i32 = convoys.iter().map(|c| store.compute_score(&c.id)).sum();

    let nickname = convoys.first().map(|c| c.nickname.as_str()).unwrap_or("");

    let is_friend = config.trusted_peers.contains(&peer_id);
    let is_blocked = config.blocked_authors.contains(&peer_id);

    let convoy_list: Vec<serde_json::Value> = convoys.iter().map(|c| {
        serde_json::json!({
            "id": c.id,
            "name": c.event.name,
            "game": c.event.game,
            "mode": c.event.mode,
            "meetingTimestamp": c.schedule.meeting_timestamp,
            "channel": c.channel,
            "score": store.compute_score(&c.id),
        })
    }).collect();

    Ok(serde_json::json!({
        "peerId": peer_id,
        "nickname": nickname,
        "reputation": reputation,
        "convoyCount": convoys.len(),
        "isFriend": is_friend,
        "isBlocked": is_blocked,
        "convoys": convoy_list,
    }))
}

// --- Comandos de convoys ---

#[tauri::command]
async fn publish_convoy(
    state: State<'_, AppState>,
    event: EventData,
    schedule: Schedule,
    flyer: Option<FlyerData>,
    channel: Option<String>,
    channel_password: Option<String>,
    id: Option<String>,
) -> Result<ConvoyRecord, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let config = load_config_cached(&state.config).await;
    let nickname = config.nickname.clone().unwrap_or_default();

    // Nick obligatorio
    if nickname.trim().is_empty() {
        return Err("Definí un nickname en tu perfil antes de publicar.".to_string());
    }
    if nickname.len() > 32 {
        return Err("El nickname no puede tener más de 32 caracteres.".to_string());
    }

    // Rate limiting: máximo 1 convoy cada 60 segundos
    const PUBLISH_COOLDOWN: i64 = 60;
    if let Some(last_ts) = config.last_publish_ts {
        let now = chrono::Utc::now().timestamp();
        if now - last_ts < PUBLISH_COOLDOWN {
            return Err(format!("Debés esperar {} segundos antes de publicar otro convoy.", PUBLISH_COOLDOWN - (now - last_ts)));
        }
    }

    let channel_name = channel.unwrap_or_default().trim().to_lowercase();
    if !channel_name.is_empty() {
        let ch_store = state.channel_store.write().await;

        if !ch_store.can_publish(&channel_name, channel_password.as_deref()) {
            return Err("Wrong channel password".to_string());
        }

        if ch_store.get_channel(&channel_name).is_none() {
            return Err("Channel does not exist".to_string());
        }
    }

    let mut record = ConvoyRecord::new(
        p2p.peer_id(),
        nickname,
        event,
        schedule,
        flyer,
        channel_name,
        id,
    );

    let now = chrono::Utc::now().timestamp();
    if !record.is_within_publish_window(now) {
        return Err("Event is too far in the future (max 3 months)".to_string());
    }

    record.sign(&p2p.secret_key).map_err(|e| format!("Failed to sign: {}", e))?;

    {
        let mut store = state.convoy_store.write().await;
        store.upsert_convoy(record.clone());
        flush_convoy_store(&store, &state.data_dir);
    }

    // Actualizar timestamp de última publicación
    {
        let mut cfg = load_config_cached(&state.config).await;
        cfg.last_publish_ts = Some(chrono::Utc::now().timestamp());
        let _ = save_config_cached(&state.data_dir, &state.config, &cfg).await;
    }

    if let Some(sender) = &p2p.gossip_sender {
        let convoy_json = serde_json::to_string(&record).map_err(|e| format!("Failed to serialize: {}", e))?;
        if let Err(e) = P2pState::publish_convoy_gossip(sender, &convoy_json).await {
            eprintln!("[P2P] Failed to publish convoy via gossip: {}", e);
        }
    }

    Ok(record)
}

#[tauri::command]
async fn list_convoys(
    state: State<'_, AppState>,
    from_date: Option<i64>,
    to_date: Option<i64>,
) -> Result<Vec<ConvoyRecord>, String> {
    let store = state.convoy_store.read().await;
    let convoys = store.list_convoys(from_date, to_date);
    Ok(convoys.into_iter().cloned().collect())
}

#[tauri::command]
async fn get_all_votes(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<VoteRecord>>, String> {
    let store = state.convoy_store.read().await;
    let all_votes: HashMap<String, Vec<VoteRecord>> = store
        .votes
        .iter()
        .map(|(convoy_id, votes)| (convoy_id.clone(), votes.values().cloned().collect()))
        .collect();
    Ok(all_votes)
}

// --- Comandos de canales ---

/// Info de canal para el frontend (con campos calculados)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelInfo {
    name: String,
    display_name: String,
    is_system: bool,
    is_owner: bool,
    has_password: bool,
}

#[tauri::command]
async fn list_channels(state: State<'_, AppState>) -> Result<Vec<ChannelInfo>, String> {
    let store = state.channel_store.read().await;
    let p2p = state.p2p.read().await;
    let my_peer_id = p2p.as_ref().map(|p| p.peer_id()).unwrap_or_default();

    let channels: Vec<ChannelInfo> = store.channels.values().map(|ch| {
        ChannelInfo {
            name: ch.name.clone(),
            display_name: if ch.display_name.is_empty() { ch.name.clone() } else { ch.display_name.clone() },
            is_system: ch.is_system(),
            is_owner: ch.is_owner(&my_peer_id),
            has_password: ch.password_hash.is_some(),
        }
    }).collect();

    Ok(channels)
}

// --- Comandos de nicks conocidos ---

#[tauri::command]
async fn get_known_nicks(state: State<'_, AppState>) -> Result<KnownNicksStore, String> {
    let store = state.known_nicks.read().await;
    Ok(store.clone())
}

#[tauri::command]
async fn set_nick_alias(state: State<'_, AppState>, peer_id: String, alias: String) -> Result<(), String> {
    let mut store = state.known_nicks.write().await;
    store.set_alias(peer_id, alias);
    store.save(&state.data_dir);
    Ok(())
}

#[tauri::command]
async fn get_display_name(state: State<'_, AppState>, peer_id: String) -> Result<String, String> {
    let store = state.known_nicks.read().await;
    Ok(store.display_name(&peer_id))
}

#[tauri::command]
async fn get_system_channels() -> Vec<String> {
    SYSTEM_CHANNELS.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
async fn validate_channel_password(
    state: State<'_, AppState>,
    channel: String,
    password: Option<String>,
) -> Result<bool, String> {
    let store = state.channel_store.read().await;
    Ok(store.can_publish(&channel, password.as_deref()))
}

#[tauri::command]
async fn activate_channel(
    state: State<'_, AppState>,
    key: String,
    password: String,
    display_name: String,
) -> Result<String, String> {
    let mut store = state.channel_store.write().await;

    let channel_name = store.activate_channel(&key, password, display_name, &MASTER_PUBLIC_KEY)?;

    flush_channel_store(&store, &state.data_dir);

    Ok(channel_name)
}

#[tauri::command]
async fn change_channel_password(
    state: State<'_, AppState>,
    channel: String,
    new_password: String,
) -> Result<(), String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut store = state.channel_store.write().await;

    store.change_password(&channel, &p2p.peer_id(), new_password)?;

    flush_channel_store(&store, &state.data_dir);

    Ok(())
}

#[tauri::command]
async fn delete_channel(
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut store = state.channel_store.write().await;

    store.delete_channel(&name, &p2p.peer_id())?;

    flush_channel_store(&store, &state.data_dir);

    Ok(())
}

// --- Comandos de votos ---

#[tauri::command]
async fn vote_convoy(
    state: State<'_, AppState>,
    convoy_id: String,
    vote: i32,
) -> Result<(), String> {
    if vote != 1 && vote != -1 {
        return Err("Vote must be 1 or -1".to_string());
    }

    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let my_peer_id = p2p.peer_id();

    let mut store = state.convoy_store.write().await;

    if !store.convoys.contains_key(&convoy_id) {
        return Err("Convoy not found".to_string());
    }

    if let Some(convoy) = store.convoys.get(&convoy_id) {
        if convoy.peer_id == my_peer_id {
            return Err("Cannot vote on your own convoy".to_string());
        }
    }

    let mut vote_record = VoteRecord::new(convoy_id, my_peer_id, vote);
    vote_record.sign(&p2p.secret_key).map_err(|e| format!("Failed to sign vote: {}", e))?;

    store.upsert_vote(vote_record.clone());
    flush_convoy_store(&store, &state.data_dir);

    if let Some(sender) = &p2p.gossip_sender {
        let vote_json = serde_json::to_string(&vote_record).map_err(|e| format!("Failed to serialize: {}", e))?;
        if let Err(e) = P2pState::publish_vote_gossip(sender, &vote_json).await {
            eprintln!("[P2P] Failed to publish vote via gossip: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_my_votes(state: State<'_, AppState>) -> Result<HashMap<String, i32>, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;
    let my_peer_id = p2p.peer_id();

    let store = state.convoy_store.read().await;
    let my_votes: HashMap<String, i32> = store
        .votes
        .iter()
        .filter_map(|(convoy_id, votes)| {
            votes.get(&my_peer_id).map(|v| (convoy_id.clone(), v.vote))
        })
        .collect();

    Ok(my_votes)
}

#[tauri::command]
async fn delete_convoy(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<(), String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut store = state.convoy_store.write().await;
    let convoy = store.convoys.get(&convoy_id)
        .ok_or("Convoy not found")?;

    if convoy.peer_id != p2p.peer_id() {
        return Err("Can only delete your own convoys".to_string());
    }

    store.delete_convoy(&convoy_id);
    flush_convoy_store(&store, &state.data_dir);

    let delete_msg = format!("{}:{}", convoy_id, p2p.peer_id());
    let delete_sig = {
        use ed25519_dalek::{Signer, SigningKey};
        let key_bytes = p2p.secret_key.to_bytes();
        let signing_key = SigningKey::from_bytes(&key_bytes);
        let sig = signing_key.sign(delete_msg.as_bytes());
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            sig.to_bytes(),
        )
    };

    if let Some(sender) = &p2p.gossip_sender {
        if let Err(e) = P2pState::publish_delete_gossip(
            sender, &convoy_id, &p2p.peer_id(), &delete_sig
        ).await {
            eprintln!("[P2P] Failed to publish delete via gossip: {}", e);
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to get app data dir: {}", e))?;
            let convoy_store = Arc::new(RwLock::new({
                let mut s = ConvoyStore::load(&data_dir).unwrap_or_default();
                s.purge_expired();
                flush_convoy_store(&s, &data_dir);
                s
            }));
            let channel_store = Arc::new(RwLock::new({
                let mut store = ChannelStore::load(&data_dir).unwrap_or_default();
                store.ensure_system_channels();
                flush_channel_store(&store, &data_dir);
                store
            }));
            let blacklist_store = Arc::new(RwLock::new(BlacklistStore::load(&data_dir).unwrap_or_default()));
            let trustlist_store = Arc::new(RwLock::new(TrustlistStore::load(&data_dir).unwrap_or_default()));
            let known_nicks = Arc::new(RwLock::new(KnownNicksStore::load(&data_dir)));
            let config = p2p::load_config(&data_dir).unwrap_or_default();
            app.manage(AppState {
                p2p: RwLock::new(None),
                data_dir: data_dir.clone(),
                convoy_store: convoy_store.clone(),
                channel_store: channel_store.clone(),
                blacklist_store: blacklist_store.clone(),
                trustlist_store: trustlist_store.clone(),
                known_nicks: known_nicks.clone(),
                config: Arc::new(RwLock::new(config)),
            });

            // Purge expired convoys every hour
            let purge_dir = data_dir.clone();
            let purge_store = convoy_store.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    let mut store = purge_store.write().await;
                    store.purge_expired();
                    flush_convoy_store(&store, &purge_dir);
                }
            });

            // Purge expired blacklists every 6 hours
            {
                let bl_dir = data_dir.clone();
                let bl_store = blacklist_store.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
                        let mut store = bl_store.write().await;
                        store.purge_expired();
                        flush_blacklist_store(&store, &bl_dir);
                    }
                });
            }

            // Purge expired trustlists every 6 hours
            {
                let tl_dir = data_dir.clone();
                let tl_store = trustlist_store.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
                        let mut store = tl_store.write().await;
                        store.purge_expired();
                        flush_trustlist_store(&store, &tl_dir);
                    }
                });
            }

            // Purge expired channels every 12 hours
            {
                let ch_dir = data_dir.clone();
                let ch_store = channel_store.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(12 * 3600)).await;
                        let mut store = ch_store.write().await;
                        store.purge_expired();
                        flush_channel_store(&store, &ch_dir);
                    }
                });
            }

            // --- System Tray ---
            let quit = MenuItem::with_id(app, "quit", "Quit ConvoyRun", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show ConvoyRun", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show, &quit])?;

            // Flag para permitir cierre real desde el menú "Quit"
            let quitting = Arc::new(AtomicBool::new(false));

            let quitting_for_menu = quitting.clone();
            tauri::tray::TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/icon.png"))
                .tooltip("ConvoyRun — Convoy & Event Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            quitting_for_menu.store(true, Ordering::Relaxed);
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Hide to tray on close (X button) — unless "Quit" was clicked
            if let Some(window) = app.get_webview_window("main") {
                let win_for_close = window.clone();
                let quitting_for_close = quitting.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if quitting_for_close.load(Ordering::Relaxed) {
                            return; // Permitir cierre real
                        }
                        api.prevent_close();
                        let _ = win_for_close.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_file,
            optimize_png,
            p2p_init,
            p2p_restart,
            p2p_status,
            export_identity,
            import_identity,
            get_config,
            set_config,
            block_author,
            unblock_author,
            publish_blacklist,
            import_blacklist,
            stop_following_blacklist,
            get_public_blacklists,
            publish_trustlist,
            import_trustlist,
            stop_following_trustlist,
            get_public_trustlists,
            get_author_profile,
            get_discovery_state,
            publish_convoy,
            list_convoys,
            vote_convoy,
            get_my_votes,
            get_all_votes,
            list_channels,
            get_system_channels,
            validate_channel_password,
            activate_channel,
            change_channel_password,
            delete_channel,
            delete_convoy,
            upload_to_catbox,
            get_known_nicks,
            set_nick_alias,
            get_display_name,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
