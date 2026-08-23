// Aísla la API de Tauri: el resto de la app no sabe que corre en un webview.
// Los comandos de Swarm tienen fallback a un almacén local (localStorage) para
// poder probar el frontend en modo demo hasta que exista el backend iroh.
const tauri = () => window.__TAURI__;

const SWARM_CACHE_KEY = 'convoyrun-swarm-cache';
const SWARM_VOTES_KEY = 'convoyrun-swarm-votes';
const SWARM_MY_VOTES_KEY = 'convoyrun-swarm-my-votes';
const SWARM_CONFIG_KEY = 'convoyrun-swarm-config';

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
    } catch {
        // cuota llena o localStorage no disponible: el demo pierde la persistencia
    }
}

export async function saveFile(bytes, suggestedName, filters = [{ name: 'PNG Image', extensions: ['png'] }]) {
    const path = await tauri().dialog.save({ defaultPath: suggestedName, filters });
    if (!path) return null; // canceló el diálogo
    await tauri().core.invoke('save_file', { path, contents: Array.from(bytes) });
    return path;
}

export async function copyToClipboard(text) {
    await tauri().clipboardManager.writeText(text);
}

// Reencodea el PNG (máxima compresión, sin pérdida) del lado de Rust.
export async function optimizePng(arrayBuffer) {
    const optimized = await tauri().core.invoke('optimize_png', { bytes: Array.from(new Uint8Array(arrayBuffer)) });
    return new Uint8Array(optimized).buffer;
}

// ---- Swarm: comandos con fallback local (modo demo) ---------------------------

export async function swarmInit() {
    try {
        const s = await tauri().core.invoke('p2p_init');
        if (s && s.mode) return s;
    } catch { /* sin backend */ }
    return { mode: 'local', online: false, peerId: '' };
}

export async function swarmStatus() {
    try {
        const s = await tauri().core.invoke('p2p_status');
        if (s && s.mode) return s;
    } catch { /* sin backend */ }
    return { mode: 'local', online: false };
}

export async function swarmPublish(convoy, channel, channelPassword) {
    try {
        await tauri().core.invoke('publish_convoy', {
            event: convoy.event,
            schedule: convoy.schedule,
            flyer: convoy.flyer || null,
            channel: channel || null,
            channelPassword: channelPassword || null,
        });
        return { backend: true };
    } catch {
        const cache = localRead(SWARM_CACHE_KEY, []);
        cache.push({ ...convoy, peerId: convoy.peerId || 'local-user' });
        localWrite(SWARM_CACHE_KEY, cache);
        return { backend: false };
    }
}

export async function swarmList() {
    try {
        const rows = await tauri().core.invoke('list_convoys');
        if (Array.isArray(rows)) return rows;
    } catch { /* sin backend */ }
    return localRead(SWARM_CACHE_KEY, []);
}

export async function swarmGetVotes() {
    try {
        const v = await tauri().core.invoke('get_all_votes');
        if (v) return v;
    } catch { /* sin backend */ }
    return localRead(SWARM_VOTES_KEY, {});
}

export async function swarmGetMyVotes() {
    try {
        const v = await tauri().core.invoke('get_my_votes');
        if (v) return v;
    } catch { /* sin backend */ }
    return localRead(SWARM_MY_VOTES_KEY, {});
}

// vote: 1 (a favor) o -1 (en contra). Reemplaza el voto anterior del autor.
export async function swarmVote(convoyId, vote) {
    try {
        await tauri().core.invoke('vote_convoy', { convoyId, vote });
        return vote;
    } catch {
        const votes = localRead(SWARM_VOTES_KEY, {});
        const my = localRead(SWARM_MY_VOTES_KEY, {});
        const prev = my[convoyId] || 0;
        const v = votes[convoyId] || { up: 0, down: 0 };
        if (prev === 1) v.up = Math.max(0, v.up - 1);
        if (prev === -1) v.down = Math.max(0, v.down - 1);
        my[convoyId] = vote;
        if (vote === 1) v.up += 1;
        if (vote === -1) v.down += 1;
        votes[convoyId] = v;
        localWrite(SWARM_VOTES_KEY, votes);
        localWrite(SWARM_MY_VOTES_KEY, my);
        return vote;
    }
}

export async function swarmGetConfig() {
    try {
        const c = await tauri().core.invoke('get_config');
        if (c) return c;
    } catch { /* sin backend */ }
    return Object.assign({ nickname: '', trustedPeers: [], filters: {} }, localRead(SWARM_CONFIG_KEY, {}));
}

export async function swarmSetConfig(config) {
    try {
        await tauri().core.invoke('set_config', { config });
        return { backend: true };
    } catch {
        localWrite(SWARM_CONFIG_KEY, config);
        return { backend: false };
    }
}

export async function swarmDelete(convoyId) {
    try {
        await tauri().core.invoke('delete_convoy', { convoyId });
        return { backend: true };
    } catch {
        const cache = localRead(SWARM_CACHE_KEY, []);
        localWrite(SWARM_CACHE_KEY, cache.filter(c => c.id !== convoyId));
        return { backend: false };
    }
}

export async function swarmListChannels() {
    try {
        const ch = await tauri().core.invoke('list_channels');
        if (Array.isArray(ch)) return ch;
    } catch { /* sin backend */ }
    return [];
}

export async function createChannel(name, password) {
    try {
        return await tauri().core.invoke('create_channel', { name, password: password || null });
    } catch {
        return null;
    }
}

export async function deleteChannel(name) {
    try {
        await tauri().core.invoke('delete_channel', { name });
        return true;
    } catch {
        return false;
    }
}

export async function swarmValidateChannel(channel, password) {
    try {
        const ok = await tauri().core.invoke('validate_channel_password', { channel, password: password || null });
        return ok;
    } catch {
        return true;
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

export async function addFriend(peerId) {
    try {
        await tauri().core.invoke('add_friend', { peerId });
        return true;
    } catch {
        return false;
    }
}

export async function removeFriend(peerId) {
    try {
        await tauri().core.invoke('remove_friend', { peerId });
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

export async function getMutualFriends(peerId) {
    try {
        const friends = await tauri().core.invoke('get_mutual_friends', { peerId });
        if (Array.isArray(friends)) return friends;
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
