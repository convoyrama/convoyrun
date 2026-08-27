// Aísla la API de Tauri: el resto de la app no sabe que corre en un webview.
// Los comandos de Swarm tienen fallback a un almacén local (localStorage) para
// poder probar el frontend en modo demo hasta que exista el backend iroh.
const tauri = () => window.__TAURI__;

const SWARM_CACHE_KEY = 'convoyrun-swarm-cache';
const SWARM_VOTES_KEY = 'convoyrun-swarm-votes';
const SWARM_MY_VOTES_KEY = 'convoyrun-swarm-my-votes';
const SWARM_CONFIG_KEY = 'convoyrun-swarm-config';
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
const CATBOX_TIMEOUT_MS = 60000; // 60 seconds
const CATBOX_MAX_RETRIES = 2;

export async function uploadToCatbox(arrayBuffer) {
    // Validate file size
    if (arrayBuffer.byteLength > CATBOX_MAX_SIZE) {
        const mb = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
        throw new Error(`FILE_TOO_LARGE:${mb}`);
    }

    let lastError = null;

    for (let attempt = 0; attempt <= CATBOX_MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CATBOX_TIMEOUT_MS);

        try {
            const blob = new Blob([arrayBuffer], { type: 'image/png' });
            const formData = new FormData();
            formData.append('reqtype', 'fileupload');
            formData.append('fileToUpload', blob, 'flyer.png');

            const resp = await fetch('https://catbox.moe/user/api.php', {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                throw new Error(`HTTP_ERROR:${resp.status}`);
            }

            const url = (await resp.text()).trim();
            if (!url.startsWith('https://')) {
                throw new Error(`INVALID_RESPONSE:${url.substring(0, 50)}`);
            }

            return url;
        } catch (err) {
            clearTimeout(timeoutId);

            if (err.name === 'AbortError') {
                lastError = new Error('TIMEOUT');
            } else if (err.message?.startsWith('FILE_TOO_LARGE:') ||
                       err.message?.startsWith('HTTP_ERROR:') ||
                       err.message?.startsWith('INVALID_RESPONSE:')) {
                // Non-retryable errors
                throw err;
            } else {
                // Network error — retry
                lastError = err;
            }

            // Wait before retry (exponential backoff: 1s, 2s)
            if (attempt < CATBOX_MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    throw lastError || new Error('UPLOAD_FAILED');
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

export async function swarmStatus() {
    try {
        const s = await tauri().core.invoke('p2p_status');
        if (s && s.mode) return s;
    } catch { /* sin backend */ }
    return { mode: 'local', online: false };
}

export async function swarmPublish(convoy, channel, channelPassword) {
    try {
        const result = await tauri().core.invoke('publish_convoy', {
            event: convoy.event,
            schedule: convoy.schedule,
            flyer: convoy.flyer || null,
            channel: channel || null,
            channelPassword: channelPassword || null,
        });
        return { backend: true, result };
    } catch (err) {
        console.warn('[BRIDGE] Backend publish_convoy failed, caching locally:', err);
        const local = { ...convoy, peerId: convoy.peerId || 'local-user' };
        const cache = localRead(SWARM_CACHE_KEY, []);
        cache.push(local);
        localWrite(SWARM_CACHE_KEY, cache);
        throw err;
    }
}

export async function swarmList() {
    const local = localRead(SWARM_CACHE_KEY, []);
    const deleted = localRead(SWARM_DELETED_KEY, []);
    const deletedSet = new Set(deleted);
    const localFiltered = local.filter(c => !deletedSet.has(c.id));
    try {
        const rows = await tauri().core.invoke('list_convoys');
        if (Array.isArray(rows)) {
            const byId = new Map();
            rows.filter(c => !deletedSet.has(c.id)).forEach(c => byId.set(c.id, c));
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
    } catch (err) {
        console.warn('[BRIDGE] delete_convoy failed:', err);
        throw err;
    }
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

export async function activateChannel(key, password, displayName) {
    try {
        return await tauri().core.invoke('activate_channel', { key, password, displayName });
    } catch (err) {
        throw new Error(err.message || err);
    }
}

export async function changeChannelPassword(channel, newPassword) {
    try {
        await tauri().core.invoke('change_channel_password', { channel, newPassword });
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

