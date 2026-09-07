// Aísla la API de Tauri: el resto de la app no sabe que corre en un webview.
// Los comandos de Swarm tienen fallback a un almacén local (localStorage) para
// poder probar el frontend en modo demo hasta que exista el backend iroh.
const tauri = () => window.__TAURI__;

const SWARM_CACHE_KEY = 'convoyrun-swarm-cache';
const SWARM_VOTES_KEY = 'convoyrun-swarm-votes';
const SWARM_MY_VOTES_KEY = 'convoyrun-swarm-my-votes';
const SWARM_CONFIG_KEY = 'convoyrun-swarm-config';
const SWARM_CONFIG_FALLBACK_KEY = 'convoyrun-swarm-config-fallback';
const SWARM_DELETED_KEY = 'convoyrun-swarm-deleted';

function localRead(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function localWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('[BRIDGE] localStorage write failed (quota?):', e.message);
    }
}

function normalizeConvoyRecord(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const event = raw.event || raw.data || {};
    const scheduleSource = raw.schedule || event.schedule || raw.data?.schedule || {};
    const meetingAt = scheduleSource.meetingAt || scheduleSource.meeting_at || raw.meetingAt || raw.meeting_at || null;
    const meetingTimestamp = Number.isFinite(scheduleSource.meetingTimestamp)
        ? scheduleSource.meetingTimestamp
        : Number.isFinite(raw.meetingTimestamp)
            ? raw.meetingTimestamp
            : (meetingAt ? Math.floor(Date.parse(meetingAt) / 1000) : NaN);
    const schedule = {
        ...scheduleSource,
        meetingTimestamp,
        ianaTimeZone: scheduleSource.ianaTimeZone || scheduleSource.timeZone || raw.ianaTimeZone || raw.timeZone || '',
    };
    const peerId = raw.peerId || raw.peer_id || raw.authorId || raw.author_id || event.peerId || '';
    const nickname = raw.nickname || raw.nick || raw.data?.nickname || '';
    const publishedAt = Number.isFinite(raw.publishedAt)
        ? raw.publishedAt
        : Number.isFinite(raw.published_at)
            ? raw.published_at
            : Math.floor(Date.parse(raw.createdAt || raw.created_at || meetingAt || new Date().toISOString()) / 1000);
    const channel = raw.channel || raw.data?.channel || '';
    const mode = raw.mode || event.mode || raw.data?.mode || 'simulation';
    const server = event.server || event.network?.server || raw.server || '';
    const link = event.link || event.links?.[0]?.url || raw.link || '';
    const eventWithAliases = {
        ...event,
        mode,
        server,
        link,
        schedule,
    };
    return {
        ...raw,
        event: eventWithAliases,
        schedule,
        peerId,
        nickname,
        publishedAt,
        channel,
    };
}

function upsertLocalConvoyCache(convoy) {
    try {
        if (!convoy?.id) return;
        const cache = localRead(SWARM_CACHE_KEY, []);
        const deleted = new Set(localRead(SWARM_DELETED_KEY, []));
        const next = cache.filter(c => c?.id !== convoy.id && !deleted.has(c?.id));
        next.push(convoy);
        localWrite(SWARM_CACHE_KEY, next);
    } catch (err) {
        console.warn('[BRIDGE] local convoy cache update failed:', err);
    }
}

// Limpiar eventos local-user residuales del cache al cargar
try {
    const _cache = localRead(SWARM_CACHE_KEY, []);
    const _filtered = _cache.filter(c => c.peerId !== 'local-user');
    if (_filtered.length !== _cache.length) {
        localWrite(SWARM_CACHE_KEY, _filtered);
        console.log(`[BRIDGE] Cleaned ${_cache.length - _filtered.length} stale local-user events`);
    }
} catch { /* ignore */ }

export async function saveFile(bytes, suggestedName, filters = [{ name: 'PNG Image', extensions: ['png'] }]) {
    const path = await tauri().dialog.save({ defaultPath: suggestedName, filters });
    if (!path) return null; // canceló el diálogo
    await tauri().core.invoke('save_file', { path, contents: bytes });
    return path;
}

export async function copyToClipboard(text) {
    await tauri().clipboardManager.writeText(text);
}

// Reencodea el PNG (máxima compresión, sin pérdida) del lado de Rust.
export async function optimizePng(arrayBuffer) {
    const optimized = await tauri().core.invoke('optimize_png', { bytes: new Uint8Array(arrayBuffer) });
    return new Uint8Array(optimized).buffer;
}

const CATBOX_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function uploadToCatbox(arrayBuffer) {
    if (arrayBuffer.byteLength > CATBOX_MAX_SIZE) {
        const mb = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
        throw new Error(`FILE_TOO_LARGE:${mb}`);
    }

    // Upload desde Rust (reqwest multipart) — evita CORS del webview
    const url = await tauri().core.invoke('upload_to_catbox', {
        bytes: new Uint8Array(arrayBuffer),
    });
    return url;
}

// ---- Swarm: comandos con fallback local (modo demo) ---------------------------

export async function swarmInit() {
    try {
        const s = await tauri().core.invoke('p2p_init');
        if (s && s.mode) return s;
    } catch (err) {
        console.warn('[BRIDGE] p2p_init failed:', err);
    }
    return { mode: 'local', online: false, peerId: '' };
}

export async function swarmRestart() {
    try {
        const s = await tauri().core.invoke('p2p_restart');
        if (s && s.mode) return s;
    } catch (err) {
        console.warn('[BRIDGE] p2p_restart failed:', err);
    }
    return { mode: 'local', online: false, peerId: '' };
}

export async function resetLocalData() {
    try {
        localStorage.removeItem(SWARM_CACHE_KEY);
        localStorage.removeItem(SWARM_VOTES_KEY);
        localStorage.removeItem(SWARM_MY_VOTES_KEY);
        localStorage.removeItem(SWARM_CONFIG_KEY);
        localStorage.removeItem(SWARM_CONFIG_FALLBACK_KEY);
        localStorage.removeItem(SWARM_DELETED_KEY);
    } catch (err) {
        console.warn('[BRIDGE] localStorage reset failed:', err);
    }
    try {
        await tauri().core.invoke('reset_local_data');
    } catch (err) {
        console.warn('[BRIDGE] reset_local_data failed:', err);
    }
}

export async function getAutostart() {
    try {
        return await tauri().core.invoke('plugin:autostart|is_enabled');
    } catch { return false; }
}

export async function setAutostart(enabled) {
    try {
        if (enabled) {
            await tauri().core.invoke('plugin:autostart|enable');
        } else {
            await tauri().core.invoke('plugin:autostart|disable');
        }
    } catch (err) {
        console.warn('[BRIDGE] autostart failed:', err);
    }
}

export async function openDevtools() {
    try {
        await tauri().core.invoke('open_devtools');
    } catch (err) {
        console.warn('[BRIDGE] open_devtools failed:', err);
    }
}

export async function swarmStatus() {
    try {
        const s = await tauri().core.invoke('p2p_status');
        if (s && s.mode) return s;
    } catch { /* sin backend */ }
    return { mode: 'local', online: false };
}

export async function swarmPublish(convoy, channel) {
    try {
        console.log('[BRIDGE] publish_convoy IPC call:', {
            hasEvent: !!convoy.event,
            hasSchedule: !!convoy.schedule,
            hasFlyer: !!convoy.flyer,
            channel,
        });
        const result = await tauri().core.invoke('publish_convoy', {
            event: convoy.event,
            schedule: convoy.schedule,
            flyer: convoy.flyer || null,
            channel: channel || null,
            id: convoy.id || null,
        });
        const normalized = normalizeConvoyRecord(result);
        upsertLocalConvoyCache(normalized);
        return { backend: true, result: normalized };
    } catch (err) {
        console.warn('[BRIDGE] Backend publish_convoy failed:', err);
        throw err;
    }
}

export async function swarmList() {
    const local = localRead(SWARM_CACHE_KEY, []);
    const deleted = localRead(SWARM_DELETED_KEY, []);
    const deletedSet = new Set(deleted);
    const localFiltered = local
        .filter(c => !deletedSet.has(c.id) && c.peerId !== 'local-user')
        .map(normalizeConvoyRecord);
    try {
        const rows = await tauri().core.invoke('list_convoys');
        if (Array.isArray(rows)) {
            const byId = new Map();
            rows.filter(c => !deletedSet.has(c.id)).map(normalizeConvoyRecord).forEach(c => byId.set(c.id, c));
            localFiltered.forEach(c => { if (!byId.has(c.id)) byId.set(c.id, c); });
            return Array.from(byId.values());
        }
    } catch (err) {
        console.warn('[BRIDGE] Backend list_convoys failed:', err);
    }
    return localFiltered;
}

export async function swarmGetVotes() {
    try {
        const v = await tauri().core.invoke('get_all_votes');
        if (v) return v;
    } catch { /* sin backend */ }
    return {};
}

export async function swarmGetMyVotes() {
    try {
        const v = await tauri().core.invoke('get_my_votes');
        if (v) return v;
    } catch { /* sin backend */ }
    return {};
}

// vote: 1 (a favor) o -1 (en contra). Reemplaza el voto anterior del autor.
// Los votos siempre van a la red P2P, no se almacenan localmente.
export async function swarmVote(convoyId, vote) {
    try {
        await tauri().core.invoke('vote_convoy', { convoyId, vote });
        return vote;
    } catch (err) {
        console.warn('[BRIDGE] vote_convoy failed:', err);
        throw err;
    }
}

export async function swarmGetConfig() {
    const fallback = localRead(SWARM_CONFIG_FALLBACK_KEY, null);
    if (tauri()?.core?.invoke) {
        const config = await tauri().core.invoke('get_config');
        if (fallback && typeof fallback === 'object') {
            return Object.assign({}, config, fallback);
        }
        return config;
    }
    return Object.assign({ nickname: '', trustedPeers: [], filters: {} }, localRead(SWARM_CONFIG_KEY, {}));
}

export async function swarmSetConfig(config) {
    if (tauri()?.core?.invoke) {
        try {
            await tauri().core.invoke('set_config', { config });
            try { localStorage.removeItem(SWARM_CONFIG_FALLBACK_KEY); } catch { /* ignore */ }
            return { backend: true, persisted: true };
        } catch (err) {
            console.warn('[BRIDGE] set_config backend failed, saving local fallback:', err);
            localWrite(SWARM_CONFIG_FALLBACK_KEY, config);
            return {
                backend: true,
                persisted: false,
                error: err?.message || String(err),
            };
        }
    }
    localWrite(SWARM_CONFIG_KEY, config);
    return { backend: false, persisted: true };
}

export async function swarmDelete(convoyId) {
    try {
        await tauri().core.invoke('delete_tombstone', { convoyId });
    } catch (err) {
        console.warn('[BRIDGE] delete_tombstone backend failed (cleaning locally):', err);
    }
    // Siempre limpiar del cache local, aunque el backend falle
    const cache = localRead(SWARM_CACHE_KEY, []);
    localWrite(SWARM_CACHE_KEY, cache.filter(c => c.id !== convoyId));
    const deleted = localRead(SWARM_DELETED_KEY, []);
    if (!deleted.includes(convoyId)) { deleted.push(convoyId); localWrite(SWARM_DELETED_KEY, deleted); }
    return { backend: true };
}

export async function swarmListChannels() {
    try {
        const ch = await tauri().core.invoke('list_channels');
        if (Array.isArray(ch)) return ch;
    } catch { /* sin backend */ }
    return [];
}

export async function getSystemChannels() {
    try {
        return await tauri().core.invoke('get_system_channels');
    } catch {
        return [];
    }
}

export async function activateChannel(entitlementToken, displayName = null) {
    try {
        return await tauri().core.invoke('activate_channel', { entitlementToken, displayName });
    } catch (err) {
        throw new Error(err.message || err);
    }
}

export async function grantChannelAccess(channel, granteePeerId) {
    try {
        await tauri().core.invoke('grant_channel_access', { channel, granteePeerId });
        return true;
    } catch (err) {
        throw new Error(err.message || err);
    }
}

export async function revokeChannelAccess(channel, granteePeerId) {
    try {
        await tauri().core.invoke('revoke_channel_access', { channel, granteePeerId });
        return true;
    } catch (err) {
        throw new Error(err.message || err);
    }
}

export async function renameChannel(channel, displayName) {
    try {
        await tauri().core.invoke('rename_channel', { channel, displayName });
        return true;
    } catch (err) {
        throw new Error(err.message || err);
    }
}

export async function deleteChannel(name) {
    try {
        await tauri().core.invoke('delete_channel', { name });
        return true;
    } catch (err) {
        throw new Error(err.message || err);
    }
}

// ---- Nicks conocidos ---------------------------------------------------------

export async function getKnownNicks() {
    try {
        return await tauri().core.invoke('get_known_nicks');
    } catch {
        return { nicks: {}, aliases: {} };
    }
}

export async function setNickAlias(peerId, alias) {
    try {
        await tauri().core.invoke('set_nick_alias', { peerId, alias });
        return true;
    } catch {
        return false;
    }
}

export async function getDisplayName(peerId) {
    try {
        return await tauri().core.invoke('get_display_name', { peerId });
    } catch {
        return peerId?.slice(0, 8) + '…' || '?';
    }
}

// ---- Moderación comunitaria --------------------------------------------------

export async function blockAuthor(peerId) {
    try {
        await tauri().core.invoke('block_author', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function unblockAuthor(peerId) {
    try {
        await tauri().core.invoke('unblock_author', { peerId });
        return true;
    } catch {
        return false;
    }
}


// ---- Identity backup ---------------------------------------------------------

export async function exportIdentity(outputPath, password) {
    try {
        await tauri().core.invoke('export_identity', { outputPath, password: password || null });
        return true;
    } catch {
        return false;
    }
}

export async function importIdentity(inputPath, password) {
    try {
        await tauri().core.invoke('import_identity', { inputPath, password: password || null });
        return true;
    } catch {
        return false;
    }
}

// ---- Blacklists públicas -----------------------------------------------------

export async function publishBlacklist() {
    try {
        await tauri().core.invoke('publish_blacklist');
        return true;
    } catch {
        return false;
    }
}

export async function importBlacklist(peerId) {
    try {
        await tauri().core.invoke('import_blacklist', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function stopFollowingBlacklist(peerId) {
    try {
        await tauri().core.invoke('stop_following_blacklist', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function getPublicBlacklists() {
    try {
        const list = await tauri().core.invoke('get_public_blacklists');
        if (Array.isArray(list)) return list;
    } catch { /* sin backend */ }
    return [];
}

// ---- Trustlists públicas -----------------------------------------------------

export async function publishTrustlist() {
    try {
        await tauri().core.invoke('publish_trustlist');
        return true;
    } catch {
        return false;
    }
}

export async function importTrustlist(peerId) {
    try {
        await tauri().core.invoke('import_trustlist', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function stopFollowingTrustlist(peerId) {
    try {
        await tauri().core.invoke('stop_following_trustlist', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function getPublicTrustlists() {
    try {
        const list = await tauri().core.invoke('get_public_trustlists');
        if (Array.isArray(list)) return list;
    } catch { /* sin backend */ }
    return [];
}


export async function getAuthorProfile(peerId) {
    try {
        const profile = await tauri().core.invoke('get_author_profile', { peerId });
        if (profile) return profile;
    } catch { /* sin backend */ }
    return null;
}

// ---- Discovery (auto-peer discovery via DHT) --------------------------------

export async function getDiscoveryState() {
    try {
        const state = await tauri().core.invoke('get_discovery_state');
        if (state) return state;
    } catch { /* sin backend */ }
    return { online: false, neighborCount: 0, dhtStatus: 'inactive' };
}
