use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{Manager, State};
use tokio::sync::RwLock;

mod p2p;
mod convoy;
use p2p::{NodeStatus, P2pState, GossipMessage, UserConfig};
use convoy::{ConvoyRecord, ConvoyStore, EventData, FlyerData, Schedule, VoteRecord, ChannelRecord, ChannelStore, BlacklistRecord, BlacklistStore};

/// Estado global de la app — stores en memoria con Arc<RwLock> para evitar TOCTOU
struct AppState {
    p2p: RwLock<Option<Arc<P2pState>>>,
    data_dir: PathBuf,
    convoy_store: Arc<RwLock<ConvoyStore>>,
    channel_store: Arc<RwLock<ChannelStore>>,
    blacklist_store: Arc<RwLock<BlacklistStore>>,
}

/// Helper: flush convoy store a disco (llamar con lock ya adquirido)
fn flush_convoy_store(store: &ConvoyStore, data_dir: &PathBuf) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save convoy store: {}", e);
    }
}

/// Helper: flush channel store a disco
fn flush_channel_store(store: &ChannelStore, data_dir: &PathBuf) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save channel store: {}", e);
    }
}

/// Helper: flush blacklist store a disco
fn flush_blacklist_store(store: &BlacklistStore, data_dir: &PathBuf) {
    if let Err(e) = store.save(data_dir) {
        eprintln!("[P2P] Failed to save blacklist store: {}", e);
    }
}

/// Procesa mensajes de gossip recibidos de otros nodos
async fn process_gossip_receiver(
    mut receiver: distributed_topic_tracker::GossipReceiver,
    data_dir: PathBuf,
    convoy_store: Arc<RwLock<ConvoyStore>>,
    channel_store: Arc<RwLock<ChannelStore>>,
    blacklist_store: Arc<RwLock<BlacklistStore>>,
    neighbor_count: Arc<AtomicUsize>,
) {
    eprintln!("[P2P] Gossip receiver started");
    loop {
        match receiver.next().await {
            Ok(event) => {
                match event {
                    iroh_gossip::api::Event::NeighborUp(ref peer) => {
                        let count = neighbor_count.fetch_add(1, Ordering::Relaxed) + 1;
                        eprintln!("[P2P] NeighborUp: {} (neighbors: {})", peer, count);
                        continue;
                    }
                    iroh_gossip::api::Event::NeighborDown(ref peer) => {
                        let old = neighbor_count.fetch_sub(1, Ordering::Relaxed);
                        if old == 0 {
                            neighbor_count.store(0, Ordering::Relaxed);
                        }
                        let count = neighbor_count.load(Ordering::Relaxed);
                        eprintln!("[P2P] NeighborDown: {} (neighbors: {})", peer, count);
                        continue;
                    }
                    iroh_gossip::api::Event::Received(message) => {
                if message.content.len() > 1024 * 1024 {
                    eprintln!("[P2P] Gossip message too large ({} bytes), ignoring", message.content.len());
                    continue;
                }
                if let Ok(gossip_msg) = serde_json::from_slice::<GossipMessage>(&message.content) {
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
                    };
                    if let Some(ref pid) = author_peer_id {
                        if let Ok(config) = p2p::load_config(&data_dir) {
                            if config.blocked_authors.contains(pid) {
                                eprintln!("[P2P] Blocked author {}, ignoring message", pid);
                                continue;
                            }
                        }
                    }
                    match gossip_msg {
                        GossipMessage::Convoy { data } => {
                            if let Ok(record) = serde_json::from_str::<ConvoyRecord>(&data) {
                                match record.verify() {
                                    Ok(true) => {
                                        let mut store = convoy_store.write().await;
                                        store.upsert_convoy(record);
                                        flush_convoy_store(&store, &data_dir);
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
                            }
                        }
                        GossipMessage::DeleteConvoy { convoy_id, peer_id, signature } => {
                            // Verificar firma del delete
                            use ed25519_dalek::{Verifier, VerifyingKey};
                            let sig_valid = (|| -> anyhow::Result<bool> {
                                let peer_bytes = base64::Engine::decode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &peer_id,
                                )?;
                                if peer_bytes.len() != 32 { return Ok(false); }
                                let mut key_array = [0u8; 32];
                                key_array.copy_from_slice(&peer_bytes);
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
                                match channel.verify() {
                                    Ok(true) => {}
                                    Ok(false) => {
                                        eprintln!("[P2P] Received channel with invalid signature, ignoring");
                                        continue;
                                    }
                                    Err(e) => {
                                        eprintln!("[P2P] Failed to verify channel signature: {}", e);
                                        continue;
                                    }
                                }
                                let mut store = channel_store.write().await;
                                if !store.channels.contains_key(&channel.name) {
                                    store.channels.insert(channel.name.clone(), channel);
                                    flush_channel_store(&store, &data_dir);
                                }
                            }
                        }
                        GossipMessage::Blacklist { data } => {
                            if let Ok(record) = serde_json::from_str::<BlacklistRecord>(&data) {
                                let mut store = blacklist_store.write().await;
                                store.upsert(record);
                                flush_blacklist_store(&store, &data_dir);
                            }
                        }
                    }
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

#[tauri::command]
async fn p2p_init(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let mut p2p_guard = state.p2p.write().await;

    if let Some(p2p) = p2p_guard.as_ref() {
        let config = p2p::load_config(&state.data_dir).unwrap_or_default();
        return Ok(p2p.status(config.nickname));
    }

    let mut p2p = P2pState::init(&state.data_dir)
        .await
        .map_err(|e| format!("Failed to initialize P2P: {}", e))?;

    match p2p.join_topic().await {
        Ok((sender, receiver)) => {
            p2p.gossip_sender = Some(sender);
            let data_dir = state.data_dir.clone();
            let cs = state.convoy_store.clone();
            let chs = state.channel_store.clone();
            let bls = state.blacklist_store.clone();
            let nc = p2p.neighbor_count.clone();
            tokio::spawn(async move {
                process_gossip_receiver(receiver, data_dir, cs, chs, bls, nc).await;
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
    p2p::load_config(&state.data_dir).map_err(|e| format!("Failed to load config: {}", e))
}

#[tauri::command]
async fn set_config(
    state: State<'_, AppState>,
    config: UserConfig,
) -> Result<(), String> {
    p2p::save_config(&state.data_dir, &config).map_err(|e| format!("Failed to save config: {}", e))
}

// --- Comandos de moderación comunitaria ---

#[tauri::command]
async fn block_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    if !config.blocked_authors.contains(&peer_id) {
        config.blocked_authors.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn unblock_author(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    config.blocked_authors.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn add_friend(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    if !config.friends.contains(&peer_id) {
        config.friends.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn remove_friend(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    config.friends.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Comandos de blacklists públicas ---

#[tauri::command]
async fn publish_blacklist(state: State<'_, AppState>) -> Result<(), String> {
    let config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let record = BlacklistRecord {
        schema: "convoyrun/blacklist/v1".to_string(),
        author_peer_id: p2p.peer_id(),
        blocked: config.blocked_authors.clone(),
        updated_at: chrono::Utc::now().timestamp(),
    };

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
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    if !config.followed_blacklists.contains(&peer_id) {
        config.followed_blacklists.push(peer_id);
        p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_following_blacklist(state: State<'_, AppState>, peer_id: String) -> Result<(), String> {
    let mut config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    config.followed_blacklists.retain(|id| id != &peer_id);
    p2p::save_config(&state.data_dir, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_public_blacklists(state: State<'_, AppState>) -> Result<Vec<BlacklistRecord>, String> {
    let store = state.blacklist_store.read().await;
    Ok(store.blacklists.values().cloned().collect())
}

#[tauri::command]
async fn get_mutual_friends(state: State<'_, AppState>, peer_id: String) -> Result<Vec<String>, String> {
    let config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    let store = state.convoy_store.read().await;

    let my_friends: std::collections::HashSet<String> = config.friends.iter().cloned().collect();

    let mut mutual: Vec<String> = Vec::new();
    for convoy in store.convoys.values() {
        if convoy.peer_id == peer_id && !convoy.nickname.is_empty() {
            // Los amigos mutuos son los que están en mi lista de amigos
            // y también publicaron convoys (están activos)
        }
    }

    for friend in &my_friends {
        if store.convoys.values().any(|c| &c.peer_id == friend) {
            mutual.push(friend.clone());
        }
    }

    Ok(mutual)
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
    let config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;

    let convoys: Vec<&ConvoyRecord> = store.convoys.values().filter(|c| c.peer_id == peer_id).collect();
    let reputation: i32 = convoys.iter().map(|c| store.compute_score(&c.id)).sum();

    let nickname = convoys.first().map(|c| c.nickname.as_str()).unwrap_or("");

    let my_friends: std::collections::HashSet<String> = config.friends.iter().cloned().collect();
    let mutual_friends: Vec<String> = my_friends.iter()
        .filter(|f| store.convoys.values().any(|c| &c.peer_id == *f))
        .cloned()
        .collect();

    Ok(serde_json::json!({
        "peerId": peer_id,
        "nickname": nickname,
        "reputation": reputation,
        "convoyCount": convoys.len(),
        "mutualFriends": mutual_friends,
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
) -> Result<ConvoyRecord, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let config = p2p::load_config(&state.data_dir).map_err(|e| e.to_string())?;
    let nickname = config.nickname.unwrap_or_default();

    let channel_name = channel.unwrap_or_default();
    if !channel_name.is_empty() {
        let mut ch_store = state.channel_store.write().await;

        if !ch_store.can_publish(&channel_name, channel_password.as_deref()) {
            return Err("Wrong channel password".to_string());
        }

        if ch_store.get_channel(&channel_name).is_none() {
            ch_store.create_channel(
                channel_name.clone(),
                p2p.peer_id(),
                channel_password.clone(),
            );

            // Firmar el canal antes de persistir y propagar
            if let Some(ch) = ch_store.channels.get_mut(&channel_name) {
                if let Err(e) = ch.sign(&p2p.secret_key) {
                    eprintln!("[P2P] Failed to sign channel: {}", e);
                }
            }
            flush_channel_store(&ch_store, &state.data_dir);

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

    let mut record = ConvoyRecord::new(
        p2p.peer_id(),
        nickname,
        event,
        schedule,
        flyer,
        channel_name,
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
async fn get_convoy(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<Option<ConvoyRecord>, String> {
    let store = state.convoy_store.read().await;
    Ok(store.convoys.get(&convoy_id).cloned())
}

#[tauri::command]
async fn get_convoy_votes(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<Vec<VoteRecord>, String> {
    let store = state.convoy_store.read().await;
    let votes = store.votes.get(&convoy_id)
        .map(|v| v.values().cloned().collect())
        .unwrap_or_default();
    Ok(votes)
}

#[tauri::command]
async fn get_convoy_score(
    state: State<'_, AppState>,
    convoy_id: String,
) -> Result<i32, String> {
    let store = state.convoy_store.read().await;
    Ok(store.compute_score(&convoy_id))
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

#[tauri::command]
async fn list_channels(state: State<'_, AppState>) -> Result<Vec<ChannelRecord>, String> {
    let store = state.channel_store.read().await;
    Ok(store.channels.values().cloned().collect())
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
async fn create_channel(
    state: State<'_, AppState>,
    name: String,
    password: Option<String>,
) -> Result<ChannelRecord, String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut store = state.channel_store.write().await;
    let normalized = name.trim().to_lowercase();

    if store.channels.contains_key(&normalized) {
        return Err("Channel already exists".to_string());
    }

    store.create_channel(normalized, p2p.peer_id(), password);

    let channel = store.get_channel(&name.trim().to_lowercase())
        .ok_or("Failed to create channel")?;
    let mut channel = channel.clone();

    if let Err(e) = channel.sign(&p2p.secret_key) {
        eprintln!("[P2P] Failed to sign channel: {}", e);
    }

    store.channels.insert(channel.name.clone(), channel.clone());
    flush_channel_store(&store, &state.data_dir);

    if let Some(sender) = &p2p.gossip_sender {
        let ch_json = serde_json::to_string(&channel).map_err(|e| e.to_string())?;
        if let Err(e) = P2pState::publish_channel_gossip(sender, &ch_json).await {
            eprintln!("[P2P] Failed to publish channel via gossip: {}", e);
        }
    }

    Ok(channel)
}

#[tauri::command]
async fn delete_channel(
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    let p2p_guard = state.p2p.read().await;
    let p2p = p2p_guard.as_ref().ok_or("P2P not initialized")?;

    let mut store = state.channel_store.write().await;
    let normalized = name.trim().to_lowercase();

    match store.channels.get(&normalized) {
        Some(ch) if ch.creator_peer_id == p2p.peer_id() => {
            store.channels.remove(&normalized);
            flush_channel_store(&store, &state.data_dir);
            Ok(())
        }
        Some(_) => Err("You can only delete channels you created".to_string()),
        None => Err("Channel not found".to_string()),
    }
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
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let convoy_store = Arc::new(RwLock::new({
                let mut s = ConvoyStore::load(&data_dir).unwrap_or_default();
                s.purge_expired();
                flush_convoy_store(&s, &data_dir);
                s
            }));
            let channel_store = Arc::new(RwLock::new(ChannelStore::load(&data_dir).unwrap_or_default()));
            let blacklist_store = Arc::new(RwLock::new(BlacklistStore::load(&data_dir).unwrap_or_default()));
            app.manage(AppState {
                p2p: RwLock::new(None),
                data_dir,
                convoy_store,
                channel_store,
                blacklist_store,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_file,
            optimize_png,
            p2p_init,
            p2p_status,
            export_identity,
            import_identity,
            get_config,
            set_config,
            block_author,
            unblock_author,
            add_friend,
            remove_friend,
            publish_blacklist,
            import_blacklist,
            stop_following_blacklist,
            get_public_blacklists,
            get_mutual_friends,
            get_author_profile,
            get_discovery_state,
            publish_convoy,
            list_convoys,
            get_convoy,
            get_convoy_votes,
            get_convoy_score,
            vote_convoy,
            get_my_votes,
            get_all_votes,
            list_channels,
            validate_channel_password,
            create_channel,
            delete_channel,
            delete_convoy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
