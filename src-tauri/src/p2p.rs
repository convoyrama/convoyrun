//! Módulo P2P de ConvoyRun — iroh 1.0 + gossip + blobs
//!
//! Referencia: cardan/docs/iroh-1.0-reference.md

use anyhow::{Context, Result};
use iroh::{endpoint::presets, protocol::Router, Endpoint, SecretKey};
use iroh_blobs::{store::fs::FsStore, BlobsProtocol, ALPN as BLOBS_ALPN};
use iroh_gossip::{net::Gossip, ALPN as GOSSIP_ALPN};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

// Auto-discovery via Mainline DHT
use distributed_topic_tracker::{AutoDiscoveryGossip, RecordPublisher, Config as DttConfig, TopicId as DttTopicId};

/// Topic de gossip para el calendario de convoys
/// Todos los nodos de ConvoyRun se unen a este topic por nombre.
pub const CONVOY_TOPIC: &str = "convoyrama.convoyrun.v3";

/// Passphrase compartido para discovery por DHT.
/// Todos los clientes de ConvoyRun lo usan para encontrarse automáticamente
/// via la Mainline DHT de BitTorrent (BEP 44).
/// Es público — cualquier persona con este passphrase puede unirse a la red.
const CONVOY_PASSPHRASE: &str = "convoyrun-convoy-calendar-v1";

/// Nombre del archivo de identidad (SecretKey)
const IDENTITY_FILE: &str = "node_identity.key";

use std::collections::HashSet;

/// Estado del nodo P2P
pub struct P2pState {
    #[allow(dead_code)] // kept alive for iroh resource ownership
    pub endpoint: Endpoint,
    #[allow(dead_code)]
    pub blobs: Arc<FsStore>,
    pub gossip: Gossip,
    #[allow(dead_code)]
    pub router: Router,
    pub secret_key: SecretKey,
    #[allow(dead_code)]
    pub data_dir: PathBuf,
    pub gossip_sender: Option<distributed_topic_tracker::GossipSender>,
    pub neighbor_count: Arc<AtomicUsize>,
}

/// Estado público del nodo (para la UI)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    pub mode: String, // "online", "offline", "local"
    pub peer_id: String,
    pub nickname: Option<String>,
    pub online: bool,
}

/// Configuración persistente del usuario
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserConfig {
    pub nickname: Option<String>,
    pub blocked_authors: HashSet<String>,
    pub followed_blacklists: Vec<String>,
    #[serde(default)]
    pub trusted_peers: Vec<String>,
    #[serde(default)]
    pub followed_trustlists: Vec<String>,
    #[serde(default)]
    pub default_languages: Vec<String>,
    #[serde(default)]
    pub last_publish_ts: Option<i64>,
}

impl P2pState {
    /// Inicializa el nodo P2P.
    /// Carga o crea la identidad, configura el endpoint, gossip y blobs.
    pub async fn init(data_dir: &Path) -> Result<Self> {
        // Crear directorio de datos si no existe
        std::fs::create_dir_all(data_dir).context("Failed to create data directory")?;

        // Cargar o crear identidad
        let secret_key = load_or_create_identity(data_dir)?;
        let peer_id = secret_key.public().to_string();

        eprintln!("[P2P] Node starting with peerId: {}", peer_id);

        // Endpoint con relays públicos (presets::N0 incluye DNS/Pkarr + relays default)
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key.clone())
            .bind()
            .await
            .context("Failed to bind endpoint")?;

        // Blobs (almacenamiento de imágenes de flyers)
        let blobs_dir = data_dir.join("blobs");
        std::fs::create_dir_all(&blobs_dir).context("Failed to create blobs directory")?;
        let blobs = FsStore::load(&blobs_dir)
            .await
            .context("Failed to load blob store")?;

        // Gossip (propagación de eventos y votos)
        let gossip = Gossip::builder().spawn(endpoint.clone());

        // Router — wire all protocols
        let router = Router::builder(endpoint.clone())
            .accept(BLOBS_ALPN, BlobsProtocol::new(&blobs, None))
            .accept(GOSSIP_ALPN, gossip.clone())
            .spawn();

        eprintln!("[P2P] Node initialized with peerId: {}", peer_id);

        Ok(Self {
            endpoint,
            blobs: Arc::new(blobs),
            gossip,
            router,
            secret_key,
            data_dir: data_dir.to_path_buf(),
            gossip_sender: None,
            neighbor_count: Arc::new(AtomicUsize::new(0)),
        })
    }

    /// Obtiene el peerId del nodo
    pub fn peer_id(&self) -> String {
        self.secret_key.public().to_string()
    }

    /// Obtiene el estado actual del nodo
    pub fn status(&self, nickname: Option<String>) -> NodeStatus {
        let nc = self.neighbor_count.load(std::sync::atomic::Ordering::Relaxed);
        NodeStatus {
            mode: if nc > 0 { "online" } else { "searching" }.to_string(),
            peer_id: self.peer_id(),
            nickname,
            online: nc > 0,
        }
    }
}

/// Carga la identidad desde el archivo o crea una nueva.
fn load_or_create_identity(data_dir: &Path) -> Result<SecretKey> {
    let identity_path = data_dir.join(IDENTITY_FILE);

    if identity_path.exists() {
        // Cargar identidad existente
        let key_bytes = std::fs::read(&identity_path)
            .context("Failed to read identity file")?;

        if key_bytes.len() != 32 {
            anyhow::bail!("Invalid identity file: expected 32 bytes, got {}", key_bytes.len());
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);

        let secret_key = SecretKey::from_bytes(&key_array);
        eprintln!("[P2P] Loaded existing identity");
        Ok(secret_key)
    } else {
        // Crear nueva identidad
        let secret_key = SecretKey::generate();
        let key_bytes = secret_key.to_bytes();

        // Escribir con permisos restrictivos (solo owner)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let f = std::fs::File::create(&identity_path)
                .context("Failed to create identity file")?;
            f.set_permissions(perms)
                .context("Failed to set identity file permissions")?;
            std::fs::write(&identity_path, key_bytes)
                .context("Failed to write identity file")?;
        }
        #[cfg(not(unix))]
        {
            // On Windows, default file permissions restrict access to the current user
            // in standard user profiles. No explicit ACL manipulation needed.
            std::fs::write(&identity_path, key_bytes)
                .context("Failed to write identity file")?;
        }

        eprintln!("[P2P] Created new identity");
        Ok(secret_key)
    }
}

/// Exporta la identidad usando key bytes en memoria (evita lectura de disco).
pub fn export_identity_with_key(
    key_bytes: &[u8],
    data_dir: &Path,
    output_path: &Path,
    password: Option<&str>,
) -> Result<()> {

    // Cargar configuración completa para incluir listas en el backup
    let config_path = data_dir.join("convoyrun_config.json");
    let (nickname, blocked_authors, trusted_peers, followed_blacklists, followed_trustlists) = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).ok();
        match config_str.and_then(|s| serde_json::from_str::<UserConfig>(&s).ok()) {
            Some(c) => (
                c.nickname,
                c.blocked_authors.into_iter().collect::<Vec<_>>(),
                c.trusted_peers,
                c.followed_blacklists,
                c.followed_trustlists,
            ),
            None => (None, vec![], vec![], vec![], vec![]),
        }
    } else {
        (None, vec![], vec![], vec![], vec![])
    };

    let export = if let Some(pwd) = password {
        // Encriptar con AES-256-GCM
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
        use rand::RngCore;
        use argon2::Argon2;

        let mut rng = rand::thread_rng();

        // Salt aleatorio de 16 bytes para KDF
        let mut salt_bytes = [0u8; 16];
        rng.fill_bytes(&mut salt_bytes);

        // Derivar clave de 32 bytes con Argon2id
        let mut derived_key = [0u8; 32];
        Argon2::default()
            .hash_password_into(pwd.as_bytes(), &salt_bytes, &mut derived_key)
            .map_err(|e| anyhow::anyhow!("KDF failed: {}", e))?;

        let cipher = Aes256Gcm::new_from_slice(&derived_key).context("Failed to create cipher")?;

        // Nonce aleatorio de 12 bytes
        let mut nonce_bytes = [0u8; 12];
        rng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encriptar
        let encrypted = cipher
            .encrypt(nonce, key_bytes.as_ref())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        // Serializar (version 2 con argon2)
        let export_data = serde_json::json!({
            "version": 2,
            "encrypted": true,
            "kdf": "argon2id",
            "algorithm": "aes-256-gcm",
            "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, salt_bytes),
            "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce_bytes),
            "encryptedKey": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, encrypted),
            "nickname": nickname,
            "blockedAuthors": blocked_authors,
            "trustedPeers": trusted_peers,
            "followedBlacklists": followed_blacklists,
            "followedTrustlists": followed_trustlists,
            "exportedAt": chrono::Utc::now().timestamp(),
        });

        export_data
    } else {
        // Sin encriptar
        let export_data = serde_json::json!({
            "version": 1,
            "encrypted": false,
            "secretKey": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key_bytes),
            "nickname": nickname,
            "blockedAuthors": blocked_authors,
            "trustedPeers": trusted_peers,
            "followedBlacklists": followed_blacklists,
            "followedTrustlists": followed_trustlists,
            "exportedAt": chrono::Utc::now().timestamp(),
        });

        export_data
    };

    std::fs::write(output_path, serde_json::to_string_pretty(&export)?)
        .context("Failed to write export file")?;

    Ok(())
}

/// Importa la identidad desde un archivo JSON (para restaurar backup).
pub fn import_identity(
    data_dir: &Path,
    input_path: &Path,
    password: Option<&str>,
) -> Result<()> {
    let export_str = std::fs::read_to_string(input_path)
        .context("Failed to read import file")?;

    let export: serde_json::Value = serde_json::from_str(&export_str)
        .context("Failed to parse import file")?;

    let version = export["version"].as_u64().unwrap_or(0);
    if version != 2 {
        anyhow::bail!("Unsupported export version: {}. Only v2 (Argon2id) is supported.", version);
    }

    let encrypted = export["encrypted"].as_bool().unwrap_or(false);
    let key_bytes = if encrypted {
        // Desencriptar
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

        let pwd = password.ok_or_else(|| anyhow::anyhow!("Password required for encrypted backup"))?;

        let nonce_b64 = export["nonce"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing nonce in encrypted backup"))?;
        let encrypted_b64 = export["encryptedKey"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing encryptedKey in encrypted backup"))?;
        let salt_b64 = export["salt"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing salt in backup"))?;

        let nonce_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, nonce_b64)
            .context("Failed to decode nonce")?;
        let encrypted_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted_b64)
            .context("Failed to decode encrypted key")?;
        let salt_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, salt_b64)
            .context("Failed to decode salt")?;

        // v2: Argon2id con salt
        use argon2::Argon2;
        let mut key = [0u8; 32];
        Argon2::default()
            .hash_password_into(pwd.as_bytes(), &salt_bytes, &mut key)
            .map_err(|e| anyhow::anyhow!("KDF failed: {}", e))?;

        let cipher = Aes256Gcm::new_from_slice(&key).context("Failed to create cipher")?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        cipher
            .decrypt(nonce, encrypted_bytes.as_ref())
            .map_err(|_| anyhow::anyhow!("Decryption failed (wrong password?)"))?
    } else {
        // Sin encriptar
        let key_b64 = export["secretKey"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing secretKey in backup"))?;

        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, key_b64)
            .context("Failed to decode secret key")?
    };

    if key_bytes.len() != 32 {
        anyhow::bail!("Invalid key size: expected 32 bytes, got {}", key_bytes.len());
    }

    // Guardar identidad — backup previo de la existente
    let identity_path = data_dir.join(IDENTITY_FILE);
    if identity_path.exists() {
        let backup_path = data_dir.join(format!("{}.bak", IDENTITY_FILE));
        std::fs::copy(&identity_path, &backup_path)
            .context("Failed to backup existing identity")?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let f = std::fs::File::create(&identity_path)
            .context("Failed to create identity file")?;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))
            .context("Failed to set identity file permissions")?;
        std::fs::write(&identity_path, &key_bytes)
            .context("Failed to write identity file")?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&identity_path, &key_bytes)
            .context("Failed to write identity file")?;
    }

    // Restaurar nickname y listas si existen
    if let Some(nick) = export["nickname"].as_str() {
        let config_path = data_dir.join("convoyrun_config.json");
        let mut config = if config_path.exists() {
            let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
            serde_json::from_str::<UserConfig>(&config_str).unwrap_or_default()
        } else {
            UserConfig::default()
        };
        config.nickname = Some(nick.to_string());

        // Restaurar listas del backup (merge sin duplicados)
        if let Some(arr) = export["blockedAuthors"].as_array() {
            for v in arr {
                if let Some(s) = v.as_str() {
                    config.blocked_authors.insert(s.to_string());
                }
            }
        }
        if let Some(arr) = export["trustedPeers"].as_array() {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if !config.trusted_peers.contains(&s.to_string()) {
                        config.trusted_peers.push(s.to_string());
                    }
                }
            }
        }
        if let Some(arr) = export["followedBlacklists"].as_array() {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if !config.followed_blacklists.contains(&s.to_string()) {
                        config.followed_blacklists.push(s.to_string());
                    }
                }
            }
        }
        if let Some(arr) = export["followedTrustlists"].as_array() {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if !config.followed_trustlists.contains(&s.to_string()) {
                        config.followed_trustlists.push(s.to_string());
                    }
                }
            }
        }

        std::fs::write(&config_path, serde_json::to_string_pretty(&config)?)
            .context("Failed to write config file")?;
    }

    eprintln!("[P2P] Identity imported successfully");
    Ok(())
}

/// Carga la configuración del usuario desde disco.
pub fn load_config(data_dir: &Path) -> Result<UserConfig> {
    let config_path = data_dir.join("convoyrun_config.json");
    if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path)
            .context("Failed to read config file")?;
        let config: UserConfig = serde_json::from_str(&config_str)
            .context("Failed to parse config file")?;
        Ok(config)
    } else {
        Ok(UserConfig::default())
    }
}

/// Guarda la configuración del usuario a disco (atómico: temp + rename).
pub fn save_config(data_dir: &Path, config: &UserConfig) -> Result<()> {
    let config_path = data_dir.join("convoyrun_config.json");
    let tmp_path = data_dir.join("convoyrun_config.json.tmp");
    std::fs::write(&tmp_path, serde_json::to_string_pretty(config)?)
        .context("Failed to write config temp file")?;
    std::fs::rename(&tmp_path, &config_path)
        .context("Failed to rename config temp file")?;
    Ok(())
}

// --- Gossip ---

/// Tipo de mensaje de gossip
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GossipMessage {
    #[serde(rename = "convoy")]
    Convoy { data: String },
    #[serde(rename = "vote")]
    Vote { data: String },
    #[serde(rename = "delete_convoy")]
    DeleteConvoy { convoy_id: String, peer_id: String, signature: String },
    #[serde(rename = "channel")]
    Channel { data: String },
    #[serde(rename = "blacklist")]
    Blacklist { data: String },
    #[serde(rename = "trustlist")]
    Trustlist { data: String },
}

impl P2pState {
    /// Se une al topic de gossip con auto-discovery vía Mainline DHT.
    /// No necesita bootstrap peers — los peers se encuentran automáticamente
    /// usando la DHT de BitTorrent (BEP 44) via distributed-topic-tracker.
    pub async fn join_topic(&self) -> Result<(distributed_topic_tracker::GossipSender, distributed_topic_tracker::GossipReceiver)> {
        // Derivar signing key ed25519 desde la SecretKey de iroh
        let key_bytes = self.secret_key.to_bytes();
        let key_array: [u8; 32] = key_bytes.into();
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_array);

        // TopicId desde el nombre del topic
        let topic_id = DttTopicId::new(CONVOY_TOPIC.to_string());

        // RecordPublisher gestiona publicación y descubrimiento en DHT
        let dtt_config = DttConfig::builder()
            .publisher_config(
                distributed_topic_tracker::config::PublisherConfig::Enabled(
                    distributed_topic_tracker::config::PublisherConfigInner::builder()
                        .initial_delay(std::time::Duration::from_secs(3))
                        .base_interval(std::time::Duration::from_secs(5))
                        .max_jitter(std::time::Duration::from_secs(5))
                        .build(),
                ),
            )
            .bootstrap_config(
                distributed_topic_tracker::config::BootstrapConfig::builder()
                    .no_peers_retry_interval(std::time::Duration::from_millis(500))
                    .discovery_poll_interval(std::time::Duration::from_secs(1))
                    .build(),
            )
            .merge_config(
                distributed_topic_tracker::config::MergeConfig::builder()
                    .bubble_merge(
                        distributed_topic_tracker::config::BubbleMergeConfig::Enabled(
                            distributed_topic_tracker::config::BubbleMergeConfigInner::builder()
                                .initial_interval(std::time::Duration::from_secs(10))
                                .base_interval(std::time::Duration::from_secs(15))
                                .max_jitter(std::time::Duration::from_secs(5))
                                .build(),
                        ),
                    )
                    .build(),
            )
            .build();

        let record_publisher = RecordPublisher::new(
            topic_id,
            signing_key,
            None,                      // sin rotación custom de secretos
            CONVOY_PASSPHRASE.as_bytes().to_vec(),
            dtt_config,
        );

        // subscribe_and_join_with_auto_discovery_no_wait:
        // 1. Publica el endpoint en la Mainline DHT
        // 2. Lee records de otros nodos que compartan el mismo passphrase
        // 3. Se conecta a peers descubiertos via QUIC + NAT traversal
        // 4. Retorna inmediatamente sin esperar peers (non-blocking)
        let topic = self.gossip
            .subscribe_and_join_with_auto_discovery_no_wait(record_publisher)
            .await?;

        let (sender, receiver) = topic.split().await?;

        eprintln!("[P2P] Joined topic with auto-discovery: {}", CONVOY_TOPIC);
        Ok((sender, receiver))
    }

    /// Publica un mensaje por gossip usando el sender
    pub async fn publish_gossip(sender: &distributed_topic_tracker::GossipSender, message: GossipMessage) -> Result<()> {
        let data = serde_json::to_vec(&message)?;
        sender.broadcast(data).await?;
        Ok(())
    }

    /// Publica un convoy por gossip
    pub async fn publish_convoy_gossip(sender: &distributed_topic_tracker::GossipSender, convoy_json: &str) -> Result<()> {
        let message = GossipMessage::Convoy {
            data: convoy_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

    /// Publica un voto por gossip
    pub async fn publish_vote_gossip(sender: &distributed_topic_tracker::GossipSender, vote_json: &str) -> Result<()> {
        let message = GossipMessage::Vote {
            data: vote_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

    /// Publica un delete de convoy por gossip
    pub async fn publish_delete_gossip(sender: &distributed_topic_tracker::GossipSender, convoy_id: &str, peer_id: &str, signature: &str) -> Result<()> {
        let message = GossipMessage::DeleteConvoy {
            convoy_id: convoy_id.to_string(),
            peer_id: peer_id.to_string(),
            signature: signature.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

    /// Publica una lista negra por gossip
    pub async fn publish_blacklist_gossip(sender: &distributed_topic_tracker::GossipSender, blacklist_json: &str) -> Result<()> {
        let message = GossipMessage::Blacklist {
            data: blacklist_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

    /// Publica una lista de confianza por gossip
    pub async fn publish_trustlist_gossip(sender: &distributed_topic_tracker::GossipSender, trustlist_json: &str) -> Result<()> {
        let message = GossipMessage::Trustlist {
            data: trustlist_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

}
