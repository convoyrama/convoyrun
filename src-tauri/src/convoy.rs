//! Módulo de datos de convoys — schema, validación, firma, almacenamiento local

use anyhow::{Context, Result};
use iroh::SecretKey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Schema version
pub const SCHEMA_CONVOY: &str = "convoyrun/convoy/v1";
pub const SCHEMA_VOTE: &str = "convoyrun/vote/v1";

/// Juegos soportados
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Game {
    ATS,
    ETS2,
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
}

/// Datos del evento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventData {
    pub name: String,
    pub game: Game,
    pub mode: Mode,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub start_place: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub description: String,
}

/// Horarios del evento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    /// Timestamp Unix (UTC) de la reunión
    pub meeting_timestamp: i64,
    /// Zona horaria IANA del creador (ej: "America/Argentina/Buenos_Aires")
    pub iana_time_zone: String,
}

/// Imagen del flyer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlyerData {
    /// Hash blake3 del PNG completo (en blobs)
    pub blob_hash: String,
    /// Tamaño en bytes
    pub size: u64,
    /// Thumbnail base64 (256px)
    pub thumb: String,
}

/// Registro de convoy (publicado por un autor)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvoyRecord {
    pub schema: String,
    pub id: String,
    pub peer_id: String,
    #[serde(default)]
    pub nickname: String,
    pub published_at: i64,
    pub event: EventData,
    pub schedule: Schedule,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flyer: Option<FlyerData>,
    /// Firma ed25519 del payload canónico (sin este campo)
    #[serde(default)]
    pub signature: String,
}

/// Registro de voto
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteRecord {
    pub schema: String,
    pub convoy_id: String,
    pub voter_peer_id: String,
    /// +1 o -1
    pub vote: i32,
    pub ts: i64,
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
    ) -> Self {
        Self {
            schema: SCHEMA_CONVOY.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            peer_id,
            nickname,
            published_at: chrono::Utc::now().timestamp(),
            event,
            schedule,
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

    /// Guarda el store a disco
    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let store_path = data_dir.join("convoy_store.json");
        std::fs::write(&store_path, serde_json::to_string_pretty(self)?)
            .context("Failed to write convoy store")?;
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

    /// Calcula el score de un convoy
    pub fn compute_score(&self, convoy_id: &str) -> i32 {
        self.votes
            .get(convoy_id)
            .map(|votes| votes.values().map(|v| v.vote).sum())
            .unwrap_or(0)
    }

    /// Calcula la reputación de un autor (suma de scores de sus convoys)
    pub fn author_reputation(&self, peer_id: &str) -> i32 {
        self.convoys
            .values()
            .filter(|c| c.peer_id == peer_id)
            .map(|c| self.compute_score(&c.id))
            .sum()
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

/// Serialización canónica JSON (claves ordenadas recursivamente)
fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
        serde_json::Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonical_json).collect();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(obj) => {
            let mut keys: Vec<_> = obj.keys().collect();
            keys.sort();
            let items: Vec<String> = keys
                .iter()
                .map(|k| format!("\"{}\":{}", k, canonical_json(&obj[*k])))
                .collect();
            format!("{{{}}}", items.join(","))
        }
    }
}
