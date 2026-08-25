import {
    swarmStatus, swarmGetConfig, swarmSetConfig,
    blockAuthor, unblockAuthor, addFriend, removeFriend,
    exportIdentity, importIdentity,
    publishBlacklist, importBlacklist, stopFollowingBlacklist,
    getPublicBlacklists,
    swarmListChannels, createChannel, deleteChannel,
} from './native/tauri-bridge.js';
import { setVisible } from './core/utils.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const overlay = () => $('#settings-overlay');

function t(key, fallback) {
    return (window.__convoyrunLangData && window.__convoyrunLangData[key]) || fallback;
}

function truncPeer(id) {
    if (!id || id.length < 16) return id || '—';
    return id.slice(0, 8) + '…' + id.slice(-6);
}

const AVAILABLE_LANGUAGES = [
    { code: 'es', key: 'swarm_lang_es' },
    { code: 'en', key: 'swarm_lang_en' },
    { code: 'pt', key: 'swarm_lang_pt' },
    { code: 'fr', key: 'swarm_lang_fr' },
    { code: 'de', key: 'swarm_lang_de' },
    { code: 'it', key: 'swarm_lang_it' },
    { code: 'nl', key: 'swarm_lang_nl' },
];

function renderDefaultLanguages(langs) {
    const container = $('#settings-default-languages');
    if (!container) return;
    container.replaceChildren();
    for (const lang of AVAILABLE_LANGUAGES) {
        const lbl = document.createElement('label');
        lbl.className = 'settings-lang-option';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        cb.checked = (langs || []).includes(lang.code);
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + t(lang.key, lang.code.toUpperCase())));
        container.appendChild(lbl);
    }
}

function getDefaultLanguages() {
    const container = $('#settings-default-languages');
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

async function loadSettingsData() {
    try {
        const [status, config] = await Promise.all([swarmStatus(), swarmGetConfig()]);

        $('#settings-peer-id').textContent = status.peerId || '—';
        $('#settings-nickname').value = config.nickname || '';

        renderDefaultLanguages(config.defaultLanguages || ['es']);
        renderBlocked(config.blockedAuthors || []);
        renderFriends(config.friends || []);
        renderFollowed(config.followedBlacklists || []);
        await renderChannels(status.peerId || '');

        const lists = await getPublicBlacklists();
        renderExplore(lists, config.followedBlacklists || []);
    } catch (err) {
        console.error('[SETTINGS] Failed to load data:', err);
    }
}

function renderBlocked(blocked) {
    const container = $('#settings-blocked-list');
    const empty = $('#settings-blocked-empty');
    container.replaceChildren();
    if (!blocked.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    blocked.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const code = document.createElement('code');
        code.title = peerId;
        code.textContent = truncPeer(peerId);
        item.appendChild(code);
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = t('settings_unblock', 'Unblock');
        btn.onclick = async () => {
            await unblockAuthor(peerId);
            await loadSettingsData();
        };
        item.appendChild(btn);
        container.appendChild(item);
    });
}

function renderFriends(friends) {
    const container = $('#settings-friends-list');
    const empty = $('#settings-friends-empty');
    container.replaceChildren();
    if (!friends.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    friends.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const code = document.createElement('code');
        code.title = peerId;
        code.textContent = truncPeer(peerId);
        item.appendChild(code);
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = t('settings_remove_friend', 'Remove friend');
        btn.onclick = async () => {
            await removeFriend(peerId);
            await loadSettingsData();
        };
        item.appendChild(btn);
        container.appendChild(item);
    });
}

function renderFollowed(followed) {
    const container = $('#settings-followed-lists');
    const empty = $('#settings-followed-empty');
    container.replaceChildren();
    if (!followed.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    followed.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const code = document.createElement('code');
        code.title = peerId;
        code.textContent = truncPeer(peerId);
        item.appendChild(code);
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = t('settings_stop_following', 'Stop following');
        btn.onclick = async () => {
            await stopFollowingBlacklist(peerId);
            await loadSettingsData();
        };
        item.appendChild(btn);
        container.appendChild(item);
    });
}

function renderExplore(lists, followed) {
    const container = $('#settings-explore-lists');
    const empty = $('#settings-explore-empty');
    container.replaceChildren();
    const followedSet = new Set(followed);
    const available = lists.filter(l => !followedSet.has(l.authorPeerId));
    if (!available.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    available.forEach(list => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const nick = document.createElement('span');
        nick.className = 'settings-nick';
        nick.textContent = list.authorPeerId ? truncPeer(list.authorPeerId) : 'Unknown';
        item.appendChild(nick);
        const count = document.createElement('code');
        const blockedCount = list.blocked ? list.blocked.length : 0;
        count.textContent = blockedCount + ' ' + t('settings_blocked_count', 'blocked');
        item.appendChild(count);
        const btn = document.createElement('button');
        btn.className = 'settings-follow-btn';
        btn.textContent = t('settings_follow', 'Follow');
        btn.onclick = async () => {
            await importBlacklist(list.authorPeerId);
            await loadSettingsData();
        };
        item.appendChild(btn);
        container.appendChild(item);
    });
}

async function renderChannels(myPeerId) {
    const container = $('#settings-channels-list');
    const empty = $('#settings-channels-empty');
    container.replaceChildren();
    const channels = await swarmListChannels();
    if (!channels.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    channels.sort((a, b) => a.name.localeCompare(b.name));
    channels.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const lockSpan = document.createElement('span');
        lockSpan.textContent = (ch.passwordHash ? '🔒 ' : '🔓 ');
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = ch.name;
        lockSpan.appendChild(nameStrong);
        item.appendChild(lockSpan);
        const creatorCode = document.createElement('code');
        const creator = ch.creatorPeerId === myPeerId ? t('settings_you', 'You') : truncPeer(ch.creatorPeerId);
        creatorCode.textContent = creator;
        item.appendChild(creatorCode);
        if (ch.creatorPeerId === myPeerId) {
            const btn = document.createElement('button');
            btn.className = 'settings-remove-btn';
            btn.textContent = '✕';
            btn.title = t('settings_delete_channel', 'Delete channel');
            btn.onclick = async () => {
                const msg = (t('settings_delete_channel_confirm', `Delete channel "${ch.name}"?`)).replace('{name}', ch.name);
                if (!confirm(msg)) return;
                await deleteChannel(ch.name);
                await renderChannels(myPeerId);
            };
            item.appendChild(btn);
        }
        container.appendChild(item);
    });
}

function openSettings() {
    const o = overlay();
    setVisible(o, true);
    o.classList.add('open');
    loadSettingsData();
}

function closeSettings() {
    const o = overlay();
    o.classList.remove('open');
    setVisible(o, false);
    setVisible($('#settings-export-options'), false);
    setVisible($('#settings-import-options'), false);
}

function switchTab(tabName) {
    $$('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === tabName));
    $$('.settings-panel').forEach(p => p.classList.toggle('active', p.id === `settings-panel-${tabName}`));
}

// Init — usar requestAnimationFrame para asegurar que el DOM está listo
function initSettings() {
    const btn = $('#settings-btn');
    if (btn) {
        btn.addEventListener('click', openSettings);
        $('#settings-close')?.addEventListener('click', closeSettings);

    $$('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.settingsTab));
    });

    $('#settings-copy-peer-id')?.addEventListener('click', async () => {
        const peerId = $('#settings-peer-id').textContent;
        if (peerId && peerId !== '—') {
            try {
                const { copyToClipboard } = await import('./native/tauri-bridge.js');
                await copyToClipboard(peerId);
                $('#settings-copy-peer-id').textContent = '✓';
                setTimeout(() => { $('#settings-copy-peer-id').textContent = t('settings_peer_id_copy', 'Copy'); }, 1500);
            } catch { /* fallback: nada */ }
        }
    });

    $('#settings-save-nick')?.addEventListener('click', async () => {
        const nick = $('#settings-nickname').value.trim();
        const config = await swarmGetConfig();
        config.nickname = nick || null;
        await swarmSetConfig(config);
        $('#settings-save-nick').textContent = '✓';
        setTimeout(() => { $('#settings-save-nick').textContent = t('settings_nickname_save', 'Save'); }, 1500);
    });

    $('#settings-save-languages')?.addEventListener('click', async () => {
        const langs = getDefaultLanguages();
        const config = await swarmGetConfig();
        config.defaultLanguages = langs;
        await swarmSetConfig(config);
        $('#settings-save-languages').textContent = '✓';
        setTimeout(() => { $('#settings-save-languages').textContent = t('settings_nickname_save', 'Save'); }, 1500);
    });

    $('#settings-export-btn')?.addEventListener('click', () => {
        const opts = $('#settings-export-options');
        setVisible(opts, opts.hidden);
        setVisible($('#settings-import-options'), false);
    });

    $('#settings-import-btn')?.addEventListener('click', () => {
        const opts = $('#settings-import-options');
        setVisible(opts, opts.hidden);
        setVisible($('#settings-export-options'), false);
    });

    $('#settings-export-confirm')?.addEventListener('click', async () => {
        const tauri = window.__TAURI__;
        if (!tauri) return;
        const password = $('#settings-export-password').value || null;
        const path = await tauri.dialog.save({
            defaultPath: 'convoyrun-identity.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;
        const ok = await exportIdentity(path, password);
        if (ok) {
            $('#settings-export-confirm').textContent = `✓ ${t('settings_saved', 'Saved')}`;
            setTimeout(() => { $('#settings-export-confirm').textContent = t('settings_export_save', 'Save backup'); }, 2000);
        }
    });

    $('#settings-import-confirm')?.addEventListener('click', async () => {
        const tauri = window.__TAURI__;
        if (!tauri) return;
        const path = await tauri.dialog.open({
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;
        const password = $('#settings-import-password').value || null;
        const ok = await importIdentity(path, password);
        if (ok) {
            $('#settings-import-confirm').textContent = `✓ ${t('settings_restored', 'Restored')}`;
            setTimeout(() => { $('#settings-import-confirm').textContent = t('settings_import_open', 'Restore backup'); }, 2000);
            await loadSettingsData();
        }
    });

    $('#settings-add-friend-btn')?.addEventListener('click', async () => {
        const input = $('#settings-add-friend-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        await addFriend(peerId);
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-add-blocked-btn')?.addEventListener('click', async () => {
        const input = $('#settings-add-blocked-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        await blockAuthor(peerId);
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-create-channel-btn')?.addEventListener('click', async () => {
        const nameInput = $('#settings-channel-name-input');
        const pwdInput = $('#settings-channel-password-input');
        const name = nameInput.value.trim();
        if (!name) return;
        const password = pwdInput.value.trim() || null;
        const result = await createChannel(name, password);
        if (result) {
            nameInput.value = '';
            pwdInput.value = '';
            const status = await swarmStatus();
            await renderChannels(status.peerId || '');
        } else {
            alert(t('settings_channel_create_error', 'Could not create channel. It may already exist.'));
        }
    });

    $('#settings-publish-blacklist')?.addEventListener('click', async () => {
        try {
            await publishBlacklist();
            $('#settings-publish-blacklist').textContent = `✓ ${t('settings_published', 'Published')}`;
            setTimeout(() => {
                const el = $('#settings-publish-blacklist');
                if (el) el.textContent = t('settings_publish_blacklist', 'Publish my blacklist');
            }, 2000);
        } catch (err) {
            console.error('[SETTINGS] publishBlacklist failed:', err);
            alert(t('settings_publish_blacklist_error', 'Failed to publish blacklist. Is P2P initialized?'));
        }
    });
    }
}

// Llamar init cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
} else {
    initSettings();
}

// Escuchar cambios de idioma para mantener traducciones disponibles
window.addEventListener('languageChanged', (e) => {
    window.__convoyrunLangData = e.detail.translations;
});
