// Modelo de datos del calendario Swarm (puro: sin DOM, sin Tauri).
// Schema unificado: convoyrun/event/v1 — un evento es el concepto general,
// un convoy es un tipo de evento.

export const SCHEMA_EVENT = 'convoyrun/event/v1';

export const EVENT_TYPES = ['convoy', 'truck_show', 'exploration', 'competition', 'other'];
export const GAME_IDS = ['ats', 'ets2', 'other'];
export const MODE_IDS = ['simulation', 'realistic', 'arcade', 'race', 'other'];

// Política de retención: un evento sobrevive hasta el 3er día
// posterior al evento; solo se puede publicar hasta 3 meses adelante.
export const RETENTION_DAYS = 3;
export const PUBLISH_HORIZON_DAYS = 90;

export function isValidEventType(type) {
    return EVENT_TYPES.includes(type);
}

export function normalizeGame(game) {
    const value = String(game || '').trim().toLowerCase();
    if (value === 'ats' || value === 'ets2' || value === 'other') return value;
    return '';
}

export function isValidGame(game) {
    return !!normalizeGame(game);
}

export function isValidMode(mode) {
    return MODE_IDS.includes(mode);
}

export function createConvoy({
    title, type = 'convoy', game, mode, meetingTimestamp, ianaTimeZone,
    link = '', server = '', language = 'es',
    startCity = '', startLocation = '', destCity = '', destLocation = '',
    description = '', channel = '',
    nickname = '', peerId = null, id = null, publishedAt = null, flyer = null,
}) {
    const normalizedGame = normalizeGame(game);
    if (!title || !normalizedGame || !isValidMode(mode) || !Number.isFinite(meetingTimestamp) || !ianaTimeZone) {
        throw new Error('Evento incompleto: title, game, mode, meetingTimestamp y ianaTimeZone son obligatorios.');
    }
    const meetingAt = new Date(meetingTimestamp * 1000).toISOString();
    const route = {
        origins: startCity ? [{
            city: startCity,
            ...(startLocation ? { location: startLocation } : {}),
        }] : [],
        ...(destCity || destLocation ? {
            destination: {
                city: destCity || '',
                ...(destLocation ? { location: destLocation } : {}),
            },
        } : {}),
    };
    Object.defineProperties(route, {
        startCity: { enumerable: false, get() { return this.origins?.[0]?.city || ''; } },
        startLocation: { enumerable: false, get() { return this.origins?.[0]?.location || ''; } },
        destCity: { enumerable: false, get() { return this.destination?.city || ''; } },
        destLocation: { enumerable: false, get() { return this.destination?.location || ''; } },
    });
    const data = {
        title,
        description,
        language,
        translations: {},
        eventType: type,
        game: normalizedGame,
        network: {
            server: server || '',
            name: server || '',
            access: '',
        },
        schedule: {
            meetingAt,
            startAt: meetingAt,
            endAt: null,
            timeZone: ianaTimeZone,
        },
        route,
        requirements: null,
        links: link ? [{ rel: 'details', url: link }] : [],
        flyer,
        extensions: {},
    };
    Object.defineProperties(data.schedule, {
        meetingTimestamp: {
            enumerable: false,
            get() { return Math.floor(Date.parse(this.meetingAt) / 1000); },
        },
        ianaTimeZone: {
            enumerable: false,
            get() { return this.timeZone; },
        },
    });
    Object.defineProperties(data, {
        mode: { enumerable: false, get() { return mode; } },
        link: { enumerable: false, get() { return link; } },
        server: { enumerable: false, get() { return this.network?.server || ''; } },
    });
    const record = {
        specVersion: '1.0',
        kind: 'event',
        id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
        revision: 1,
        authorId: peerId || '',
        createdAt: new Date((publishedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        updatedAt: new Date((publishedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        data,
        signature: '',
    };
    Object.defineProperties(record, {
        schema: { enumerable: false, configurable: true, get() { return SCHEMA_EVENT; } },
        event: { enumerable: false, configurable: true, get() { return this.data; } },
        schedule: { enumerable: false, configurable: true, get() { return this.data.schedule; } },
        peerId: { enumerable: false, configurable: true, writable: true, value: peerId || '' },
        nickname: { enumerable: false, configurable: true, writable: true, value: nickname },
        publishedAt: { enumerable: false, configurable: true, writable: true, value: publishedAt ?? Math.floor(Date.now() / 1000) },
        channel: { enumerable: false, configurable: true, writable: true, value: channel },
        flyer: { enumerable: false, configurable: true, writable: true, value: flyer },
        deleteSignature: { enumerable: false, configurable: true, writable: true, value: '' },
        deleted: { enumerable: false, configurable: true, writable: true, value: false },
    });
    return record;
}

export function dayKeyUTC(ts) {
    return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function nowUnix() {
    return Math.floor(Date.now() / 1000);
}

export function isWithinPublishWindow(c, now = nowUnix()) {
    const schedule = c.schedule || c.data?.schedule;
    const meetingTimestamp = Number.isFinite(schedule?.meetingTimestamp)
        ? schedule.meetingTimestamp
        : schedule?.meetingAt
            ? Math.floor(Date.parse(schedule.meetingAt) / 1000)
            : 0;
    return meetingTimestamp <= now + PUBLISH_HORIZON_DAYS * 86400;
}

export function computeScore(votes) {
    if (!votes) return 0;
    if (Array.isArray(votes)) {
        return votes.reduce((sum, v) => sum + (v.vote || 0), 0);
    }
    return (votes.up || 0) - (votes.down || 0);
}

export function computeVoteCounts(votes) {
    if (!votes || !Array.isArray(votes)) return { up: 0, down: 0 };
    const up = votes.filter(v => v.vote === 1).length;
    const down = votes.filter(v => v.vote === -1).length;
    return { up, down };
}

export function authorReputation(convoys, votesByConvoy, peerId) {
    return convoys
        .filter(c => c.peerId === peerId && !c.deleted)
        .reduce((acc, c) => acc + computeScore(votesByConvoy[c.id]), 0);
}

export function reputationBadge(rep) {
    if (rep > 0) return 'good';
    if (rep < 0) return 'bad';
    return 'neutral';
}

// Validación estructural mínima de un registro recibido.
export function validateConvoy(c) {
    const event = c.event || c.data;
    const schedule = c.schedule || c.data?.schedule;
    return !!c
        && (c.schema === SCHEMA_EVENT || c.specVersion === '1.0')
        && typeof c.id === 'string'
        && !!event && typeof event.title === 'string'
        && isValidGame(event.game)
        && isValidMode(event.mode)
        && !!schedule && typeof schedule.meetingAt === 'string'
        && typeof schedule.timeZone === 'string';
}
