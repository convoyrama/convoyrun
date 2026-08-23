// Modelo de datos del calendario Swarm (puro: sin DOM, sin Tauri).
// Reusa el schema de metadata del PNG pero estructurado para la red.
// Referencia de diseño: docs/04_SWARM_CALENDAR.md (no versionado).

export const SCHEMA_CONVOY = 'convoyrun/convoy/v1';

export const GAME_IDS = ['ATS', 'ETS2'];
export const MODE_IDS = ['simulation', 'realistic', 'arcade'];

// Política de retención (docs §3): un convoy sobrevive hasta el 3er día
// posterior al evento; solo se puede publicar hasta 3 meses adelante.
export const RETENTION_DAYS = 3;
export const PUBLISH_HORIZON_DAYS = 90;

export function isValidGame(game) {
    return GAME_IDS.includes(game);
}

export function isValidMode(mode) {
    return MODE_IDS.includes(mode);
}

export function createConvoy({
    name, game, mode, meetingTimestamp, ianaTimeZone,
    link = '', server = '', startPlace = '', destination = '', description = '',
    nickname = '', peerId = null, id = null, publishedAt = null, flyer = null,
}) {
    if (!name || !isValidGame(game) || !isValidMode(mode) || !Number.isFinite(meetingTimestamp) || !ianaTimeZone) {
        throw new Error('Convoy incompleto: name, game, mode, meetingTimestamp y ianaTimeZone son obligatorios.');
    }
    const record = {
        schema: SCHEMA_CONVOY,
        id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
        peerId,
        nickname,
        publishedAt: publishedAt ?? Math.floor(Date.now() / 1000),
        event: { name, game, mode, link, server, startPlace, destination, description },
        schedule: { meetingTimestamp, ianaTimeZone },
    };
    if (flyer && flyer.thumb) record.flyer = flyer;
    return record;
}

// Serialización canónica (claves ordenadas) para firmar/verificar en el backend.
// Determinista: mismo objeto => misma string.
export function canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

// Identidad de dedup: mismo id+peerId = mismo convoy.
export function convoyKey(c) {
    return `${c.id}:${c.peerId || ''}`;
}

// Día de agrupación del calendario = fecha UTC del evento (docs §4.2), para que
// el mismo convoy caiga el mismo día para todos los nodos.
export function dayKeyUTC(ts) {
    return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function nowUnix() {
    return Math.floor(Date.now() / 1000);
}

// Solo se puede publicar dentro del horizonte (3 meses adelante).
export function isWithinPublishWindow(c, now = nowUnix()) {
    return c.schedule.meetingTimestamp <= now + PUBLISH_HORIZON_DAYS * 86400;
}

// Retención: se muestra/transmite hasta RETENTION_DAYS días después del evento.
export function isRetained(c, now = nowUnix()) {
    return c.schedule.meetingTimestamp + RETENTION_DAYS * 86400 > now;
}

export function computeScore(votes) {
    if (!votes) return 0;
    // Backend format: array of VoteRecord objects {vote: 1|-1, ...}
    if (Array.isArray(votes)) {
        return votes.reduce((sum, v) => sum + (v.vote || 0), 0);
    }
    // LocalStorage fallback format: {up: N, down: N}
    return (votes.up || 0) - (votes.down || 0);
}

// Reputación de un autor = suma de scores de sus convoys vigentes.
export function authorReputation(convoys, votesByConvoy, peerId) {
    return convoys
        .filter(c => c.peerId === peerId)
        .reduce((acc, c) => acc + computeScore(votesByConvoy[c.id]), 0);
}

export function reputationBadge(rep) {
    if (rep > 0) return 'good';
    if (rep < 0) return 'bad';
    return 'neutral';
}

// Validación estructural mínima de un registro recibido.
export function validateConvoy(c) {
    return !!c
        && c.schema === SCHEMA_CONVOY
        && typeof c.id === 'string'
        && !!c.event && typeof c.event.name === 'string'
        && isValidGame(c.event.game)
        && isValidMode(c.event.mode)
        && !!c.schedule && Number.isFinite(c.schedule.meetingTimestamp)
        && typeof c.schedule.ianaTimeZone === 'string';
}
