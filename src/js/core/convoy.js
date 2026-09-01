// Modelo de datos del calendario Swarm (puro: sin DOM, sin Tauri).
// Schema unificado: convoyrun/event/v1 — un evento es el concepto general,
// un convoy es un tipo de evento.

export const SCHEMA_EVENT = 'convoyrun/event/v1';

export const EVENT_TYPES = ['convoy', 'truck_show', 'exploration', 'competition', 'other'];
export const GAME_IDS = ['ATS', 'ETS2', 'other'];
export const MODE_IDS = ['simulation', 'realistic', 'arcade', 'race', 'other'];

// Política de retención: un evento sobrevive hasta el 3er día
// posterior al evento; solo se puede publicar hasta 3 meses adelante.
export const RETENTION_DAYS = 3;
export const PUBLISH_HORIZON_DAYS = 90;

export function isValidEventType(type) {
    return EVENT_TYPES.includes(type);
}

export function isValidGame(game) {
    return GAME_IDS.includes(game);
}

export function isValidMode(mode) {
    return MODE_IDS.includes(mode);
}

export function createConvoy({
    name, type = 'convoy', game, mode, meetingTimestamp, ianaTimeZone,
    link = '', server = '',
    startCity = '', startLocation = '', destCity = '', destLocation = '',
    description = '', languages = [], channel = '',
    nickname = '', peerId = null, id = null, publishedAt = null, flyer = null,
}) {
    if (!name || !isValidGame(game) || !isValidMode(mode) || !Number.isFinite(meetingTimestamp) || !ianaTimeZone) {
        throw new Error('Evento incompleto: name, game, mode, meetingTimestamp y ianaTimeZone son obligatorios.');
    }
    const record = {
        schema: SCHEMA_EVENT,
        id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
        peerId,
        nickname,
        publishedAt: publishedAt ?? Math.floor(Date.now() / 1000),
        event: {
            name,
            eventType: type,
            game, mode, link, server,
            route: { startCity, startLocation, destCity, destLocation },
            description, languages,
        },
        schedule: { meetingTimestamp, ianaTimeZone },
    };
    if (channel) record.channel = channel;
    if (flyer) record.flyer = flyer;
    return record;
}

export function dayKeyUTC(ts) {
    return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function nowUnix() {
    return Math.floor(Date.now() / 1000);
}

export function isWithinPublishWindow(c, now = nowUnix()) {
    return c.schedule.meetingTimestamp <= now + PUBLISH_HORIZON_DAYS * 86400;
}

export function computeScore(votes) {
    if (!votes) return 0;
    if (Array.isArray(votes)) {
        return votes.reduce((sum, v) => sum + (v.vote || 0), 0);
    }
    return (votes.up || 0) - (votes.down || 0);
}

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
        && c.schema === SCHEMA_EVENT
        && typeof c.id === 'string'
        && !!c.event && typeof c.event.name === 'string'
        && isValidGame(c.event.game)
        && isValidMode(c.event.mode)
        && !!c.schedule && Number.isFinite(c.schedule.meetingTimestamp)
        && typeof c.schedule.ianaTimeZone === 'string';
}
