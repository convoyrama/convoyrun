use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::RwLock;

mod p2p;
mod convoy;
use p2p::{NodeStatus, P2pState, GossipMessage, UserConfig};
use convoy::{ConvoyRecord, ConvoyStore, EventData, FlyerData, Schedule, VoteRecord, ChannelRecord, ChannelStore};

/// Estado global de la app
struct AppState {
    p2p: RwLock<Option<Arc<P2pState>>>,
    data_dir: PathBuf,
}

/// Procesa mensajes de gossip recibidos de otros nodos
async fn process_gossip_receiver(
    mut receiver: iroh_gossip::api::GossipReceiver,
    data_dir: PathBuf,
) {
    use futures_lite::stream::StreamExt;
    eprintln!("[P2P] Gossip receiver started");
    loop {
        match receiver.next().await {
            Some(Ok(event)) => {
                // Solo procesamos eventos de mensajes recibidos
                let iroh_gossip::api::Event::Received(message) = event else {
                    continue;
                };
                if let Ok(gossip_msg) = serde_json::from_slice::<GossipMessage>(&message.content) {
                    match gossip_msg {
                        GossipMessage::Convoy { data } => {
                            if let Ok(record) = serde_json::from_str::<ConvoyRecord>(&data) {
                                // Verificar firma antes de almacenar
                                match record.verify() {
                                    Ok(true) => {
                                        let mut store = match ConvoyStore::load(&data_dir) {
                                            Ok(s) => s,
                                            Err(e) => {
                                                eprintln!("[P2P] Failed to load store: {}", e);
                                                continue;
                                            }
                                        };
                                        store.upsert_convoy(record);
                                        if let Err(e) = store.save(&data_dir) {
                                            eprintln!("[P2P] Failed to save store: {}", e);
                                        }
                                    }
                                    Ok(false) => {
                                        eprintln!("[P2P] Received convoy with invalid signature, ignoring");
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify convoy signature: {}", e);
                                    }
                                }
                            }
                        }
                        GossipMessage::Vote { data } => {
                            if let Ok(record) = serde_json::from_str::<VoteRecord>(&data) {
                                let mut store = match ConvoyStore::load(&data_dir) {
                                    Ok(s) => s,
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to load store: {}", e);
                                        continue;
                                    }
                                };
                                store.upsert_vote(record);
                                if let Err(e) = store.save(&data_dir) {
                                    eprintln!("[P2P] Failed to save store: {}", e);
                                }
                            }
                        }
                        GossipMessage::DeleteConvoy { convoy_id, peer_id } => {
                            let mut store = match ConvoyStore::load(&data_dir) {
                                Ok(s) => s,
                                Err(e) => {
                                    eprintln!("[P2P] Failed to load store: {}", e);
                                    continue;
                                }
                            };
                            // Solo borrar si el delete viene del autor original
                            if let Some(convoy) = store.convoys.get(&convoy_id) {
                                if convoy.peer_id == peer_id {
                                    store.delete_convoy(&convoy_id);
                                    if let Err(e) = store.save(&data_dir) {
                                        eprintln!("[P2P] Failed to save store: {}", e);
                                    }
                                    eprintln!("[P2P] Convoy deleted by author: {}", convoy_id);
                                }
                            }
                        }
                        GossipMessage::Channel { data } => {
                            if let Ok(channel) = serde_json::from_str::<ChannelRecord>(&data) {
                                let mut ch_store = match ChannelStore::load(&data_dir) {
                                    Ok(s) => s,
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to load channel store: {}", e);
                                        continue;
                                    }
                                };
                                // Solo crear si no existe
                                if !ch_store.channels.contains_key(&channel.name) {
                                    ch_store.channels.insert(channel.name.clone(), channel);
                                    if let Err(e) = ch_store.save(&data_dir) {
                                        eprintln!("[P2P] Failed to save channel store: {}", e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Some(Err(e)) => {
                eprintln!("[P2P] Gossip receiver error: {}", e);
            }
            None => {
                eprintln!("[P2P] Gossip receiver stream ended");
                break;
            }
        }
    }
}

// --- Comandos existentes ---

#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
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

/// Inicializa el nodo P2P
#[tauri::command]
async fn p2p_init(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let mut p2p_guard = state.p2p.write().await;

    // Si ya está inicializado, retornar estado actual
    if let Some(p2p) = p2p_guard.as_ref() {
        let config = p2p::load_config(&state.data_dir).unwrap_or_default();
        return Ok(p2p.status(config.nickname));
    }

    // Inicializar nodo
    let mut p2p = P2pState::init(&state.data_dir)
        .await
        .map_err(|e| format!("Failed to initialize P2P: {}", e))?;

    // Unirse al topic de gossip
    match p2p.join_topic().await {
        Ok((sender, receiver)) => {
            p2p.gossip_sender = Some(sender);
            // Spawnear task para procesar mensajes de gossip de otros nodos
            let data_dir = state.data_dir.clone();
            tokio::spawn(async move {
                process_gossip_receiver(receiver, data_dir).await;
            });
            eprintln!("[P2P] Joined gossip topic successfully");
        }
        Err(e) => {
            eprintln!("[P2P] Failed to join topic: {}", e);
        }
    }

    let config = p2p::load_config(&state.data_dir).unwrap_or_default();
    let status = p2p.status(config.nickname);

    *p2p_guard = Some(Arc::new(p2p));

    Ok(status)
}

/// Obtiene el estado actual del nodo P2P
#[tauri::command]
async fn p2p_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let p2p_guard = state.p2p.read().await;

    match p2p_guard.as_ref() {
        Some(p2p) => {
            let config = p2p::load_config(&state.data_dir).unwrap_or_default();
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

/// Exporta la identidad a un archivo (backup)
#[tauri::command]
async fn export_identity(
    state: State<'_, AppState>,
    output_path: String,
    password: Option<String>,
) -> Result<(), String> {
    p2p::export_identity(
        &state.data_dir,
        &PathBuf::from(output_path),
        password.as_deref(),
    )
    .map_err(|e| format!("Failed to export identity: {}", e))
}

/// Importa la identidad desde un archivo (restaurar backup)
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

/// Obtiene la configuración del usuario
#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<UserConfig, String> {
    p2p::load_config(&state.data_dir).map_err(|e| format!("Failed to load config: {}", e))
}

/// Guarda la configuración del usuario
#[tauri::command]
async fn set_config(
    state: State<'_, AppState>,
    config: UserConfig,
) -> Result<(), String> {
    p2p::save_config(&state.data_dir, &config).map_err(|e| format!("Failed to save config: {}", e))
}

// --- Comandos de moderación comunitaria ---

/// Agrega un autor a la lista negra
#[tauri::command]
async fn block_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    if !config.blocked_authors.contains(&peer_id) {
        config.blocked_authors.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Quita un autor de la lista negra
#[tauri::command]
async fn unblock_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    config.blocked_authors.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Agrega un autor a la lista de amigos
#[tauri::command]
async fn add_friend(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    if !config.friends.contains(&peer_id) {
        config.friends.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Quita un autor de la lista de amigos
#[tauri::command]
async fn remove_friend(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    config.friends.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Comandos de convoys ---

/// Publica un nuevo convoy
#[tauri::command]
async fn publish_convoy(
    state: State<'_, AppState>,
    event: EventData,
    schedule: Schedule,
    flyer: Option<FlyerData>,
    channel: Option<String>,
    channel_password: Option<String>,
) -> Result<ConvoyRecord, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    // Cargar config para obtener nickname
    let config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    let nickname = config.nickname.unwrap_or_default();

    // Validar canal si se especifica
    let channel_name = channel.unwrap_or_default();
    if !channel_name.is_empty() {
        let mut ch_store = ChannelStore::load(&state.data_dir).map_err(|e| e.to_string())?;

        // Verificar password si el canal ya existe
        if !ch_store.can_publish(&channel_name, channel_password.as_deref()) {
            return Err("Wrong channel password".to_string());
        }

        // Crear canal si es nuevo
        if ch_store.get_channel(&channel_name).is_none() {
            ch_store.create_channel(
                channel_name.clone(),
                p2p.peer_id(),
                channel_password.clone(),
            );
            ch_store.save(&state.data_dir).map_err(|e| e.to_string())?;

            // Broadcast canal por gossip
            if let Some(sender) = &p2p.gossip_sender {
                if let Some(ch) = ch_store.get_channel(&channel_name) {
                    let ch_json = serde_json::to_string(ch).map_err(|e| e.to_string())?;
                    if let Err(e) = P2pState::publish_channel_gossip(sender, &ch_json).await {
                        eprintln!("[P2P] Failed to publish channel via gossip: {}", e);
                    }
                }
            }
        }
    }

    // Crear registro
    let mut record = ConvoyRecord::new(
        p2p.peer_id(),
        nickname,
        event,
        schedule,
        flyer,
        channel_name,
    );

    // Verificar que está dentro del horizonte de publicación
    let now = chrono::Utc::now().timestamp();
    if !record.is_within_publish_window(now) {
        return Err("Event is too far in the future (max 3 months)".to_string());
    }

    // Firmar el registro
    record.sign(&p2p.secret_key).map_err(|e| format!("Failed to sign: {}", e))?;

    // Guardar en store local
    let mut store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    store.upsert_convoy(record.clone());
    store.save(&state.data_dir).map_err(|e| e.to_string())?;

    // Publicar por gossip
    if let Some(sender) = &p2p.gossip_sender {
        let convoy_json = serde_json::to_string(&record).map_err(|e| format!("Failed to serialize: {}", e))?;
        if let Err(e) = P2pState::publish_convoy_gossip(sender, &convoy_json).await {
            eprintln!("[P2P] Failed to publish convoy via gossip: {}", e);
        }
    }

    Ok(record)
}

/// Lista convoys vigentes
#[tauri::command]
async fn list_convoys(
    state: State<'_, AppState>,
    from_date: Option<i64>,
    to_date: Option<i64>,
) -> Result<Vec<ConvoyRecord>, String> {
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    let convoys = store.list_convoys(from_date, to_date);
    Ok(convoys.into_iter().cloned().collect())
}

/// Obtiene un convoy por ID
#[tauri::command]
async fn get_convoy(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<Option<ConvoyRecord>, String> {
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    Ok(store.convoys.get(&convoy_id).cloned())
}

/// Obtiene los votos de un convoy
#[tauri::command]
async fn get_convoy_votes(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<Vec<VoteRecord>, String> {
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    let votes = store.votes.get(&convoy_id)
        .map(|v| v.values().cloned().collect())
        .unwrap_or_default();
    Ok(votes)
}

/// Obtiene el score de un convoy
#[tauri::command]
async fn get_convoy_score(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<i32, String> {
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    Ok(store.compute_score(&convoy_id))
}

/// Obtiene todos los votos de todos los convoys
#[tauri::command]
async fn get_all_votes(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<VoteRecord>>, String> {
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    let all_votes: HashMap<String, Vec<VoteRecord>> = store
        .votes
        .iter()
        .map(|(convoy_id, votes)| (convoy_id.clone(), votes.values().cloned().collect()))
        .collect();
    Ok(all_votes)
}

// --- Comandos de canales ---

/// Lista canales conocidos
#[tauri::command]
async fn list_channels(state: State<'_, AppState>) -> Result<Vec<ChannelRecord>, String> {
    let store = ChannelStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    Ok(store.channels.into_values().collect())
}

/// Verifica si se puede publicar en un canal
#[tauri::command]
async fn validate_channel_password(
    state: State<'_, AppState>,
    channel: String,
    password: Option<String>,
) -> Result<bool, String> {
    let store = ChannelStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    Ok(store.can_publish(&channel, password.as_deref()))
}

// --- Comandos de votos ---

/// Vota por un convoy (+1 o -1). Reemplaza el voto anterior del mismo autor.
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

    // Verificar que el convoy existe
    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    if !store.convoys.contains_key(&convoy_id) {
        return Err("Convoy not found".to_string());
    }

    // No permitir auto-voto
    let my_peer_id = p2p.peer_id();
    if let Some(convoy) = store.convoys.get(&convoy_id) {
        if convoy.peer_id == my_peer_id {
            return Err("Cannot vote on your own convoy".to_string());
        }
    }

    // Crear y firmar voto
    let mut vote_record = VoteRecord::new(convoy_id, my_peer_id, vote);
    vote_record.sign(&p2p.secret_key).map_err(|e| format!("Failed to sign vote: {}", e))?;

    // Guardar en store local
    let mut store = store;
    store.upsert_vote(vote_record.clone());
    store.save(&state.data_dir).map_err(|e| e.to_string())?;

    // Publicar por gossip
    if let Some(sender) = &p2p.gossip_sender {
        let vote_json = serde_json::to_string(&vote_record).map_err(|e| format!("Failed to serialize: {}", e))?;
        if let Err(e) = P2pState::publish_vote_gossip(sender, &vote_json).await {
            eprintln!("[P2P] Failed to publish vote via gossip: {}", e);
        }
    }

    Ok(())
}

/// Obtiene los votos del usuario actual
#[tauri::command]
async fn get_my_votes(state: State<'_, AppState>) -> Result<HashMap<String, i32>, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;
    let my_peer_id = p2p.peer_id();

    let store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    let my_votes: HashMap<String, i32> = store
        .votes
        .iter()
        .filter_map(|(convoy_id, votes)| {
            votes.get(&my_peer_id).map(|v| (convoy_id.clone(), v.vote))
        })
        .collect();

    Ok(my_votes)
}

/// Elimina un convoy propio y notifica a la red
#[tauri::command]
async fn delete_convoy(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<(), String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    // Verificar que el convoy existe y es del autor actual
    let mut store = ConvoyStore::load(&state.data_dir).map_err(|e| e.to_string())?;
    let convoy = store.convoys.get(&convoy_id)
        .ok_or("Convoy not found")?;

    if convoy.peer_id != p2p.peer_id() {
        return Err("Can only delete your own convoys".to_string());
    }

    // Borrar del store local
    store.delete_convoy(&convoy_id);
    store.save(&state.data_dir).map_err(|e| e.to_string())?;

    // Broadcast delete por gossip
    if let Some(sender) = &p2p.gossip_sender {
        if let Err(e) = P2pState::publish_delete_gossip(
            sender, &convoy_id, &p2p.peer_id()
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
        .setup(|app| {
            // Inicializar estado de la app
            let data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            app.manage(AppState {
                p2p: RwLock::new(None),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Comandos existentes
            save_file,
            optimize_png,
            // Comandos P2P
            p2p_init,
            p2p_status,
            // Comandos de backup
            export_identity,
            import_identity,
            // Comandos de configuración
            get_config,
            set_config,
            // Comandos de moderación
            block_author,
            unblock_author,
            add_friend,
            remove_friend,
            // Comandos de convoys
            publish_convoy,
            list_convoys,
            get_convoy,
            get_convoy_votes,
            get_convoy_score,
            // Comandos de votos
            vote_convoy,
            get_my_votes,
            get_all_votes,
            // Comandos de canales
            list_channels,
            validate_channel_password,
            // Comandos de delete
            delete_convoy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
