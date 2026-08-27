//! Módulo de datos de eventos — schema, validación, firma, almacenamiento local

use anyhow::{Context, Result};
use iroh::SecretKey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Schema version
pub const SCHEMA_EVENT: &str = "convoyrun/event/v1";
pub const SCHEMA_VOTE: &str = "convoyrun/vote/v1";
pub const SCHEMA_CHANNEL: &str = "convoyrun/channel/v1";

/// Canales predefinidos del sistema (públicos, sin owner)
pub const SYSTEM_CHANNELS: &[&str] = &[
    "general",
    "ats",
    "ets",
    "convoy",
    "tmp",
];

/// Peer ID especial para canales del sistema
pub const SYSTEM_PEER_ID: &str = "system";

/// Tipos de evento
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    Convoy,
    TruckShow,
    Exploration,
    Competition,
    Cruise,
    Other,
}

impl Default for EventType {
    fn default() -> Self { Self::Convoy }
}

/// Juegos soportados
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Game {
    ATS,
    ETS2,
    Other,
}

/// Modos de servidor
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Mode {
    #[serde(rename = "simulation")]
    Simulation,
    #[serde(rename = "realistic")]
    Realistic,
    #[serde(rename = "arcade")]
    Arcade,
    #[serde(rename = "race")]
    Race,
    #[serde(rename = "other")]
    Other,
}

/// Ruta del evento (ciudades y ubicaciones específicas)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    #[serde(default)]
    pub start_city: String,
    #[serde(default)]
    pub start_location: String,
    #[serde(default)]
    pub dest_city: String,
    #[serde(default)]
    pub dest_location: String,
}

/// Datos del evento
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventData {
    pub name: String,
    #[serde(default)]
    pub event_type: EventType,
    pub game: Game,
    pub mode: Mode,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub route: Route,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub languages: Vec<String>,
}

/// Horarios del evento
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    /// Timestamp Unix (UTC) de la reunión
    pub meeting_timestamp: i64,
    /// Zona horaria IANA del creador (ej: "America/Argentina/Buenos_Aires")
    pub iana_time_zone: String,
}

/// Imagen del flyer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlyerData {
    /// URL de la imagen (catbox o externa). Alias "thumb" para compatibilidad con datos viejos.
    #[serde(alias = "thumb")]
    pub url: String,
    /// Tamaño en bytes
    #[serde(default)]
    pub size: u64,
}

/// Registro de convoy (publicado por un autor)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvoyRecord {
    pub schema: String,
    pub id: String,
    pub peer_id: String,
    #[serde(default)]
    pub nickname: String,
    pub published_at: i64,
    pub event: EventData,
    pub schedule: Schedule,
    #[serde(default)]
    pub channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flyer: Option<FlyerData>,
    /// Firma ed25519 del payload canónico (sin este campo)
    #[serde(default)]
    pub signature: String,
}

/// Registro de voto
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteRecord {
    pub schema: String,
    pub convoy_id: String,
    pub voter_peer_id: String,
    /// +1 o -1
    pub vote: i32,
    pub ts: i64,
    pub signature: String,
}

/// Registro de canal (propagado por gossip)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub schema: String,
    /// Nombre interno (siempre lowercase, usado como identificador)
    pub name: String,
    /// Nombre para mostrar en la UI (puede tener mayúsculas, emojis, etc.)
    #[serde(default)]
    pub display_name: String,
    pub creator_peer_id: String,
    /// blake3 hash del password (None = público)
    pub password_hash: Option<String>,
    pub created_at: i64,
    /// Firma ed25519 del payload canónico
    #[serde(default)]
    pub signature: String,
}

/// Estado local de convoys (caché)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConvoyStore {
    pub convoys: HashMap<String, ConvoyRecord>,
    pub votes: HashMap<String, HashMap<String, VoteRecord>>, // convoy_id -> voter_peer_id -> vote
}

impl ConvoyRecord {
    /// Crea un nuevo registro de convoy
    pub fn new(
        peer_id: String,
        nickname: String,
        event: EventData,
        schedule: Schedule,
        flyer: Option<FlyerData>,
        channel: String,
    ) -> Self {
        Self {
            schema: SCHEMA_EVENT.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            peer_id,
            nickname,
            published_at: chrono::Utc::now().timestamp(),
            event,
            schedule,
            channel,
            flyer,
            signature: String::new(),
        }
    }

    /// Serialización canónica para firma (claves ordenadas, sin el campo signature)
    pub fn canonical_json(&self) -> Result<String> {
        // Crear copia sin signature
        let mut copy = self.clone();
        copy.signature = String::new();

        // Serializar con claves ordenadas
        let value = serde_json::to_value(&copy)
            .context("Failed to serialize ConvoyRecord for canonical JSON")?;
        Ok(canonical_json(&value))
    }

    /// Firma el registro con la clave secreta
    pub fn sign(&mut self, secret_key: &SecretKey) -> Result<()> {
        use ed25519_dalek::{Signer, SigningKey};

        let canonical = self.canonical_json()?;
        let message = canonical.as_bytes();

        // Convertir SecretKey de iroh a SigningKey de ed25519-dalek
        let key_bytes = secret_key.to_bytes();
        let signing_key = SigningKey::from_bytes(&key_bytes);

        let signature = signing_key.sign(message);
        self.signature = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signature.to_bytes(),
        );

        Ok(())
    }

    /// Verifica la firma del registro
    pub fn verify(&self) -> Result<bool> {
        use ed25519_dalek::{Verifier, VerifyingKey};

        if self.signature.is_empty() {
            return Ok(false);
        }

        // Decodificar peer_id a public key
        let peer_id_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.peer_id,
        )
        .context("Failed to decode peer_id")?;

        if peer_id_bytes.len() != 32 {
            return Ok(false);
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&peer_id_bytes);
        let verifying_key = VerifyingKey::from_bytes(&key_array).context("Invalid public key")?;

        // Decodificar firma
        let sig_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.signature,
        )
        .context("Failed to decode signature")?;

        if sig_bytes.len() != 64 {
            return Ok(false);
        }

        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

        // Verificar
        let canonical = self.canonical_json()?;
        let message = canonical.as_bytes();

        Ok(verifying_key.verify(message, &signature).is_ok())
    }

    /// Verifica si el convoy aún es válido (no expiró)
    pub fn is_retained(&self, now: i64) -> bool {
        const RETENTION_DAYS: i64 = 3;
        self.schedule.meeting_timestamp + RETENTION_DAYS * 86400 > now
    }

    /// Verifica si el convoy se puede publicar (dentro del horizonte)
    pub fn is_within_publish_window(&self, now: i64) -> bool {
        const PUBLISH_HORIZON_DAYS: i64 = 90;
        self.schedule.meeting_timestamp <= now + PUBLISH_HORIZON_DAYS * 86400
    }
}

impl VoteRecord {
    /// Crea un nuevo registro de voto
    pub fn new(convoy_id: String, voter_peer_id: String, vote: i32) -> Self {
        Self {
            schema: SCHEMA_VOTE.to_string(),
            convoy_id,
            voter_peer_id,
            vote,
            ts: chrono::Utc::now().timestamp(),
            signature: String::new(),
        }
    }

    /// Serialización canónica para firma
    pub fn canonical_json(&self) -> Result<String> {
        let mut copy = self.clone();
        copy.signature = String::new();
        let value = serde_json::to_value(&copy)
            .context("Failed to serialize VoteRecord for canonical JSON")?;
        Ok(canonical_json(&value))
    }

    /// Firma el voto
    pub fn sign(&mut self, secret_key: &SecretKey) -> Result<()> {
        use ed25519_dalek::{Signer, SigningKey};

        let canonical = self.canonical_json()?;
        let message = canonical.as_bytes();

        let key_bytes = secret_key.to_bytes();
        let signing_key = SigningKey::from_bytes(&key_bytes);

        let signature = signing_key.sign(message);
        self.signature = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signature.to_bytes(),
        );

        Ok(())
    }

    /// Verifica la firma del voto
    pub fn verify(&self) -> Result<bool> {
        use ed25519_dalek::{Verifier, VerifyingKey};

        if self.signature.is_empty() {
            return Ok(false);
        }

        let peer_id_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.voter_peer_id,
        )
        .context("Failed to decode voter_peer_id")?;

        if peer_id_bytes.len() != 32 {
            return Ok(false);
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&peer_id_bytes);
        let verifying_key = VerifyingKey::from_bytes(&key_array).context("Invalid public key")?;

        let sig_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.signature,
        )
        .context("Failed to decode signature")?;

        if sig_bytes.len() != 64 {
            return Ok(false);
        }

        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

        let canonical = self.canonical_json()?;
        let message = canonical.as_bytes();

        Ok(verifying_key.verify(message, &signature).is_ok())
    }
}

impl ChannelRecord {
    /// Verifica si este canal es del sistema (sin owner)
    pub fn is_system(&self) -> bool {
        self.creator_peer_id == SYSTEM_PEER_ID
    }

    /// Verifica si el peer ID dado es el dueño de este canal
    pub fn is_owner(&self, peer_id: &str) -> bool {
        if self.is_system() {
            return false; // Los canales del sistema no tienen dueño
        }
        self.creator_peer_id == peer_id
    }
}

impl ConvoyStore {
    /// Carga el store desde disco
    pub fn load(data_dir: &Path) -> Result<Self> {
        let store_path = data_dir.join("convoy_store.json");
        if store_path.exists() {
            let store_str = std::fs::read_to_string(&store_path)
                .context("Failed to read convoy store")?;
            let store: Self = serde_json::from_str(&store_str)
                .context("Failed to parse convoy store")?;
            Ok(store)
        } else {
            Ok(Self::default())
        }
    }

    /// Guarda el store a disco (write atómico: temp file + rename)
    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let store_path = data_dir.join("convoy_store.json");
        let tmp_path = data_dir.join("convoy_store.json.tmp");
        std::fs::write(&tmp_path, serde_json::to_string(self)?)
            .context("Failed to write convoy store")?;
        std::fs::rename(&tmp_path, &store_path)
            .context("Failed to rename convoy store")?;
        Ok(())
    }

    /// Agrega o actualiza un convoy
    pub fn upsert_convoy(&mut self, convoy: ConvoyRecord) {
        self.convoys.insert(convoy.id.clone(), convoy);
    }

    /// Agrega o actualiza un voto (reemplaza el anterior del mismo votante)
    pub fn upsert_vote(&mut self, vote: VoteRecord) {
        let convoy_votes = self.votes.entry(vote.convoy_id.clone()).or_default();
        convoy_votes.insert(vote.voter_peer_id.clone(), vote);
    }

    /// Elimina un convoy y sus votos del store local
    pub fn delete_convoy(&mut self, convoy_id: &str) -> bool {
        let removed = self.convoys.remove(convoy_id).is_some();
        if removed {
            self.votes.remove(convoy_id);
        }
        removed
    }

    /// Calcula el score de un convoy
    pub fn compute_score(&self, convoy_id: &str) -> i32 {
        self.votes
            .get(convoy_id)
            .map(|votes| votes.values().map(|v| v.vote).sum())
            .unwrap_or(0)
    }

    /// Lista convoys vigentes (no expirados)
    pub fn list_convoys(&self, from_date: Option<i64>, to_date: Option<i64>) -> Vec<&ConvoyRecord> {
        let now = chrono::Utc::now().timestamp();
        let mut convoys: Vec<_> = self
            .convoys
            .values()
            .filter(|c| {
                c.is_retained(now)
                    && from_date.map_or(true, |from| c.schedule.meeting_timestamp >= from)
                    && to_date.map_or(true, |to| c.schedule.meeting_timestamp <= to)
            })
            .collect();

        // Ordenar por meeting_timestamp
        convoys.sort_by_key(|c| c.schedule.meeting_timestamp);
        convoys
    }

    /// Purge convoys expirados
    pub fn purge_expired(&mut self) {
        let now = chrono::Utc::now().timestamp();
        self.convoys.retain(|_, c| c.is_retained(now));
        self.votes.retain(|id, _| self.convoys.contains_key(id));
    }
}

/// Estado local de canales
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelStore {
    pub channels: HashMap<String, ChannelRecord>,
}

impl ChannelStore {
    /// Carga el store desde disco
    pub fn load(data_dir: &Path) -> Result<Self> {
        let store_path = data_dir.join("channel_store.json");
        if store_path.exists() {
            let store_str = std::fs::read_to_string(&store_path)
                .context("Failed to read channel store")?;
            let store: Self = serde_json::from_str(&store_str)
                .context("Failed to parse channel store")?;
            Ok(store)
        } else {
            Ok(Self::default())
        }
    }

    /// Guarda el store a disco (write atómico: temp file + rename)
    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let store_path = data_dir.join("channel_store.json");
        let tmp_path = data_dir.join("channel_store.json.tmp");
        std::fs::write(&tmp_path, serde_json::to_string(self)?)
            .context("Failed to write channel store")?;
        std::fs::rename(&tmp_path, &store_path)
            .context("Failed to rename channel store")?;
        Ok(())
    }

    /// Crea los canales del sistema (si no existen)
    pub fn ensure_system_channels(&mut self) {
        for &name in SYSTEM_CHANNELS {
            if !self.channels.contains_key(name) {
                self.channels.insert(name.to_string(), ChannelRecord {
                    schema: SCHEMA_CHANNEL.to_string(),
                    name: name.to_string(),
                    display_name: name.to_string(),
                    creator_peer_id: SYSTEM_PEER_ID.to_string(),
                    password_hash: None,
                    created_at: chrono::Utc::now().timestamp(),
                    signature: String::new(),
                });
            }
        }
    }

    /// Activa un canal Patreon con key firmada
    /// Key format: base64(channel_name|peer_id|signature)
    pub fn activate_channel(
        &mut self,
        key: &str,
        password: String,
        display_name: String,
        master_public_key: &[u8; 32],
    ) -> Result<String, String> {
        // Decodificar key
        let decoded = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            key,
        ).map_err(|_| "Invalid key format".to_string())?;

        let key_str = String::from_utf8(decoded)
            .map_err(|_| "Invalid key encoding".to_string())?;

        let parts: Vec<&str> = key_str.split('|').collect();
        if parts.len() != 3 {
            return Err("Invalid key structure".to_string());
        }

        let channel_name = parts[0];
        let authorized_peer = parts[1];
        let signature_b64 = parts[2];

        // Verificar firma con master key
        let payload = format!("{}|{}", channel_name, authorized_peer);
        let payload_bytes = payload.as_bytes();

        let sig_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            signature_b64,
        ).map_err(|_| "Invalid signature encoding".to_string())?;

        if sig_bytes.len() != 64 {
            return Err("Invalid signature length".to_string());
        }

        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

        let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(master_public_key)
            .map_err(|_| "Invalid master public key".to_string())?;

        use ed25519_dalek::Verifier;
        if verifying_key.verify(payload_bytes, &signature).is_err() {
            return Err("Invalid signature".to_string());
        }

        // Verificar que el canal no exista ya
        let normalized = channel_name.trim().to_lowercase();
        if self.channels.contains_key(&normalized) {
            return Err("Channel already exists".to_string());
        }

        // Crear canal con el peer ID autorizado como owner
        let password_hash = blake3::hash(password.as_bytes()).to_hex().to_string();
        let display = if display_name.trim().is_empty() {
            normalized.clone()
        } else {
            display_name.trim().to_string()
        };

        self.channels.insert(normalized.clone(), ChannelRecord {
            schema: SCHEMA_CHANNEL.to_string(),
            name: normalized.clone(),
            display_name: display,
            creator_peer_id: authorized_peer.to_string(),
            password_hash: Some(password_hash),
            created_at: chrono::Utc::now().timestamp(),
            signature: String::new(),
        });

        Ok(normalized)
    }

    /// Cambia la contraseña de un canal (solo el owner puede)
    pub fn change_password(
        &mut self,
        channel_name: &str,
        peer_id: &str,
        new_password: String,
    ) -> Result<(), String> {
        let normalized = channel_name.trim().to_lowercase();
        let channel = self.channels.get(&normalized)
            .ok_or("Channel not found".to_string())?;

        if !channel.is_owner(peer_id) {
            return Err("Not the channel owner".to_string());
        }

        let password_hash = blake3::hash(new_password.as_bytes()).to_hex().to_string();

        if let Some(ch) = self.channels.get_mut(&normalized) {
            ch.password_hash = Some(password_hash);
        }

        Ok(())
    }

    /// Elimina un canal (solo el owner puede, no se pueden eliminar canales del sistema)
    pub fn delete_channel(&mut self, channel_name: &str, peer_id: &str) -> Result<(), String> {
        let normalized = channel_name.trim().to_lowercase();
        let channel = self.channels.get(&normalized)
            .ok_or("Channel not found".to_string())?;

        if channel.is_system() {
            return Err("Cannot delete system channel".to_string());
        }

        if !channel.is_owner(peer_id) {
            return Err("Not the channel owner".to_string());
        }

        self.channels.remove(&normalized);
        Ok(())
    }

    /// Verifica si un usuario puede publicar en un canal
    pub fn can_publish(&self, channel_name: &str, password: Option<&str>) -> bool {
        let normalized = channel_name.trim().to_lowercase();
        match self.channels.get(&normalized) {
            None => true, // canal nuevo, cualquiera puede crear
            Some(ch) => match &ch.password_hash {
                None => true, // público
                Some(hash) => {
                    let provided = match password {
                        Some(p) => blake3::hash(p.as_bytes()).to_hex().to_string(),
                        None => return false,
                    };
                    // Comparación constante para evitar timing attacks
                    if provided.len() != hash.len() { return false; }
                    let mut diff = 0u8;
                    for (a, b) in provided.bytes().zip(hash.bytes()) {
                        diff |= a ^ b;
                    }
                    diff == 0
                }
            }
        }
    }

    /// Obtiene un canal por nombre
    pub fn get_channel(&self, name: &str) -> Option<&ChannelRecord> {
        let normalized = name.trim().to_lowercase();
        self.channels.get(&normalized)
    }

    /// Elimina canales con created_at mayor a 180 días
    pub fn purge_expired(&mut self) {
        let cutoff = chrono::Utc::now().timestamp() - 180 * 86400;
        self.channels.retain(|_, ch| ch.created_at > cutoff);
    }
}

/// Registro de lista negra pública (propagado por gossip)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlacklistRecord {
    pub schema: String,
    pub author_peer_id: String,
    pub blocked: Vec<String>,
    pub updated_at: i64,
    /// Firma ed25519 del payload canónico
    #[serde(default)]
    pub signature: String,
}

impl BlacklistRecord {
    /// Serialización canónica para firma (sin el campo signature)
    pub fn canonical_json(&self) -> Result<String> {
        let mut copy = self.clone();
        copy.signature = String::new();
        let value = serde_json::to_value(&copy)
            .context("Failed to serialize BlacklistRecord for canonical JSON")?;
        Ok(canonical_json(&value))
    }

    /// Firma el registro con la clave secreta
    pub fn sign(&mut self, secret_key: &SecretKey) -> Result<()> {
        use ed25519_dalek::{Signer, SigningKey};

        let canonical = self.canonical_json()?;
        let message = canonical.as_bytes();

        let key_bytes = secret_key.to_bytes();
        let signing_key = SigningKey::from_bytes(&key_bytes);
        let signature = signing_key.sign(message);
        self.signature = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signature.to_bytes(),
        );

        Ok(())
    }

    /// Verifica la firma del registro
    pub fn verify(&self) -> Result<bool> {
        use ed25519_dalek::{Verifier, VerifyingKey};

        if self.signature.is_empty() {
            return Ok(false);
        }

        let peer_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.author_peer_id,
        )?;
        if peer_bytes.len() != 32 {
            return Ok(false);
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&peer_bytes);
        let verifying_key = VerifyingKey::from_bytes(&key_array)?;

        let sig_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.signature,
        )?;
        if sig_bytes.len() != 64 {
            return Ok(false);
        }

        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        let sig = ed25519_dalek::Signature::from_bytes(&sig_array);

        let canonical = self.canonical_json()?;
        Ok(verifying_key.verify(canonical.as_bytes(), &sig).is_ok())
    }
}

/// Estado local de blacklists públicas recibidas por gossip
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BlacklistStore {
    pub blacklists: HashMap<String, BlacklistRecord>,
}

impl BlacklistStore {
    pub fn load(data_dir: &Path) -> Result<Self> {
        let store_path = data_dir.join("blacklist_store.json");
        if store_path.exists() {
            let s = std::fs::read_to_string(&store_path)
                .context("Failed to read blacklist store")?;
            let store: Self = serde_json::from_str(&s)
                .context("Failed to parse blacklist store")?;
            Ok(store)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let store_path = data_dir.join("blacklist_store.json");
        let tmp_path = data_dir.join("blacklist_store.json.tmp");
        std::fs::write(&tmp_path, serde_json::to_string(self)?)
            .context("Failed to write blacklist store")?;
        std::fs::rename(&tmp_path, &store_path)
            .context("Failed to rename blacklist store")?;
        Ok(())
    }

    pub fn upsert(&mut self, record: BlacklistRecord) {
        self.blacklists.insert(record.author_peer_id.clone(), record);
    }

    /// Elimina blacklists con updated_at mayor a 90 días
    pub fn purge_expired(&mut self) {
        let cutoff = chrono::Utc::now().timestamp() - 90 * 86400;
        self.blacklists.retain(|_, r| r.updated_at > cutoff);
    }
}

/// Serialización canónica JSON (claves ordenadas recursivamente)
fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonical_json).collect();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(obj) => {
            let mut keys: Vec<_> = obj.keys().collect();
            keys.sort();
            let items: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string()), canonical_json(&obj[*k])))
                .collect();
            format!("{{{}}}", items.join(","))
        }
    }
}
