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

/// Topic de gossip para el calendario de convoys
/// Todos los nodos de ConvoyRun se unen a este topic por nombre.
pub const CONVOY_TOPIC: &str = "convoyrama.convoyrun.v1";

/// Nombre del archivo de identidad (SecretKey)
const IDENTITY_FILE: &str = "node_identity.key";

/// Estado del nodo P2P
pub struct P2pState {
    pub endpoint: Endpoint,
    pub blobs: Arc<FsStore>,
    pub gossip: Gossip,
    pub router: Router,
    pub secret_key: SecretKey,
    pub data_dir: PathBuf,
    pub gossip_sender: Option<iroh_gossip::api::GossipSender>,
}

/// Estado público del nodo (para la UI)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub mode: String, // "online", "offline", "local"
    pub peer_id: String,
    pub nickname: Option<String>,
    pub online: bool,
}

/// Configuración persistente del usuario
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserConfig {
    pub nickname: Option<String>,
    pub blocked_authors: Vec<String>,
    pub friends: Vec<String>,
    pub followed_blacklists: Vec<String>,
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
        })
    }

    /// Obtiene el peerId del nodo
    pub fn peer_id(&self) -> String {
        self.secret_key.public().to_string()
    }

    /// Obtiene el estado actual del nodo
    pub fn status(&self, nickname: Option<String>) -> NodeStatus {
        // TODO: Detectar estado real (online/offline) basado en conexiones
        NodeStatus {
            mode: "online".to_string(),
            peer_id: self.peer_id(),
            nickname,
            online: true,
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

        std::fs::write(&identity_path, key_bytes)
            .context("Failed to write identity file")?;

        eprintln!("[P2P] Created new identity");
        Ok(secret_key)
    }
}

/// Exporta la identidad a un archivo JSON (para backup).
/// Opcionalmente encripta con contraseña.
pub fn export_identity(
    data_dir: &Path,
    output_path: &Path,
    password: Option<&str>,
) -> Result<()> {
    let identity_path = data_dir.join(IDENTITY_FILE);
    let key_bytes = std::fs::read(&identity_path)
        .context("Failed to read identity file")?;

    // Cargar nickname si existe
    let config_path = data_dir.join("convoyrun_config.json");
    let nickname = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).ok();
        config_str
            .and_then(|s| serde_json::from_str::<UserConfig>(&s).ok())
            .and_then(|c| c.nickname)
    } else {
        None
    };

    let export = if let Some(pwd) = password {
        // Encriptar con AES-256-GCM
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
        use rand::RngCore;

        let mut rng = rand::thread_rng();

        // Derivar clave de 32 bytes desde la contraseña (simple hash, no ideal pero funcional)
        let mut key = [0u8; 32];
        let pwd_bytes = pwd.as_bytes();
        for (i, b) in pwd_bytes.iter().cycle().take(32).enumerate() {
            key[i] = *b;
        }

        let cipher = Aes256Gcm::new_from_slice(&key).context("Failed to create cipher")?;

        // Nonce aleatorio de 12 bytes
        let mut nonce_bytes = [0u8; 12];
        rng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encriptar
        let encrypted = cipher
            .encrypt(nonce, key_bytes.as_ref())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        // Serializar
        let export_data = serde_json::json!({
            "version": 1,
            "encrypted": true,
            "algorithm": "aes-256-gcm",
            "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce_bytes),
            "encryptedKey": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, encrypted),
            "nickname": nickname,
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
    if version != 1 {
        anyhow::bail!("Unsupported export version: {}", version);
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

        let nonce_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, nonce_b64)
            .context("Failed to decode nonce")?;
        let encrypted_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted_b64)
            .context("Failed to decode encrypted key")?;

        // Derivar clave (mismo método que en export)
        let mut key = [0u8; 32];
        let pwd_bytes = pwd.as_bytes();
        for (i, b) in pwd_bytes.iter().cycle().take(32).enumerate() {
            key[i] = *b;
        }

        let cipher = Aes256Gcm::new_from_slice(&key).context("Failed to create cipher")?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        cipher
            .decrypt(nonce, encrypted_bytes.as_ref())
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?
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

    // Guardar identidad
    let identity_path = data_dir.join(IDENTITY_FILE);
    std::fs::write(&identity_path, &key_bytes)
        .context("Failed to write identity file")?;

    // Restaurar nickname si existe
    if let Some(nick) = export["nickname"].as_str() {
        let config_path = data_dir.join("convoyrun_config.json");
        let mut config = if config_path.exists() {
            let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
            serde_json::from_str::<UserConfig>(&config_str).unwrap_or_default()
        } else {
            UserConfig::default()
        };
        config.nickname = Some(nick.to_string());
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

/// Guarda la configuración del usuario a disco.
pub fn save_config(data_dir: &Path, config: &UserConfig) -> Result<()> {
    let config_path = data_dir.join("convoyrun_config.json");
    std::fs::write(&config_path, serde_json::to_string_pretty(config)?)
        .context("Failed to write config file")?;
    Ok(())
}

// --- Gossip ---

use iroh_gossip::TopicId;
use iroh::EndpointId;
use bytes::Bytes;

/// Tipo de mensaje de gossip
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GossipMessage {
    #[serde(rename = "convoy")]
    Convoy { data: String }, // JSON serializado de ConvoyRecord
    #[serde(rename = "vote")]
    Vote { data: String },   // JSON serializado de VoteRecord
}

/// Convierte un string a TopicId (hash SHA-256 del string)
fn topic_id_from_string(s: &str) -> TopicId {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(s.as_bytes());
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&hash);
    TopicId::from_bytes(bytes)
}

impl P2pState {
    /// Se une al topic de gossip de convoys
    /// Retorna (sender, receiver) para publicar y recibir mensajes
    pub async fn join_topic(&self) -> Result<(iroh_gossip::api::GossipSender, iroh_gossip::api::GossipReceiver)> {
        let topic_id = topic_id_from_string(CONVOY_TOPIC);
        
        // Por ahora sin bootstrap peers (se conectarán cuando haya otros nodos)
        let bootstrap_peers: Vec<EndpointId> = Vec::new();
        
        let gossip_topic = self.gossip.subscribe(topic_id, bootstrap_peers).await?;
        let (sender, receiver) = gossip_topic.split();
        
        eprintln!("[P2P] Joined topic: {}", CONVOY_TOPIC);
        Ok((sender, receiver))
    }

    /// Publica un mensaje por gossip usando el sender
    pub async fn publish_gossip(sender: &iroh_gossip::api::GossipSender, message: GossipMessage) -> Result<()> {
        let data = serde_json::to_vec(&message)?;
        sender.broadcast(Bytes::from(data)).await?;
        Ok(())
    }

    /// Publica un convoy por gossip
    pub async fn publish_convoy_gossip(sender: &iroh_gossip::api::GossipSender, convoy_json: &str) -> Result<()> {
        let message = GossipMessage::Convoy {
            data: convoy_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }

    /// Publica un voto por gossip
    pub async fn publish_vote_gossip(sender: &iroh_gossip::api::GossipSender, vote_json: &str) -> Result<()> {
        let message = GossipMessage::Vote {
            data: vote_json.to_string(),
        };
        Self::publish_gossip(sender, message).await
    }
}
