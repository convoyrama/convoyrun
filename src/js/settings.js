import * as state from './core/state.js';
import {
    swarmStatus, swarmGetConfig, swarmSetConfig, swarmRestart,
    getAutostart, setAutostart,
    blockAuthor, unblockAuthor,
    exportIdentity, importIdentity,
    publishBlacklist, importBlacklist, stopFollowingBlacklist,
    getPublicBlacklists,
    swarmListChannels, getSystemChannels, activateChannel, changeChannelPassword, deleteChannel,
    getKnownNicks, setNickAlias,
} from './native/tauri-bridge.js';
import { setVisible } from './core/utils.js';
import { displayName, truncPeer } from './core/display-name.js';
import { AVAILABLE_LANGUAGES } from './core/config.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const overlay = () => $('#settings-overlay');

function t(key, fallback) {
    return state.currentLangData[key] || fallback;
}

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
        const [status, config, knownNicks] = await Promise.all([swarmStatus(), swarmGetConfig(), getKnownNicks()]);

        $('#settings-peer-id').textContent = status.peerId || '—';
        $('#settings-nickname').value = config.nickname || '';

        // Por defecto todos los idiomas seleccionados (primera vez)
        const savedLangs = config.defaultLanguages && config.defaultLanguages.length > 0
            ? config.defaultLanguages
            : AVAILABLE_LANGUAGES.map(l => l.code);
        renderDefaultLanguages(savedLangs);
        renderBlocked(config.blockedAuthors || [], knownNicks);
        renderTrusted(config.trustedPeers || [], knownNicks);
        renderFollowed(config.followedBlacklists || []);
        await renderChannels(status.peerId || '');

        const lists = await getPublicBlacklists();
        renderExplore(lists, config.followedBlacklists || []);
    } catch (err) {
        console.error('[SETTINGS] Failed to load data:', err);
    }
}

function renderBlocked(blocked, knownNicks) {
    const container = $('#settings-blocked-list');
    const empty = $('#settings-blocked-empty');
    container.replaceChildren();
    if (!blocked.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    blocked.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'settings-peer-name';
        nameSpan.title = peerId;
        nameSpan.textContent = displayName(peerId, null, knownNicks);
        item.appendChild(nameSpan);
        const aliasBtn = document.createElement('button');
        aliasBtn.className = 'settings-small-btn';
        aliasBtn.textContent = '✏️';
        aliasBtn.title = t('settings_alias_edit', 'Set alias');
        aliasBtn.onclick = () => promptAlias(peerId);
        item.appendChild(aliasBtn);
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

function renderTrusted(trusted, knownNicks) {
    const container = $('#settings-trusted-list');
    const empty = $('#settings-trusted-empty');
    container.replaceChildren();
    if (!trusted.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    trusted.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'settings-peer-name';
        nameSpan.title = peerId;
        nameSpan.textContent = displayName(peerId, null, knownNicks);
        item.appendChild(nameSpan);
        const aliasBtn = document.createElement('button');
        aliasBtn.className = 'settings-small-btn';
        aliasBtn.textContent = '✏️';
        aliasBtn.title = t('settings_alias_edit', 'Set alias');
        aliasBtn.onclick = () => promptAlias(peerId);
        item.appendChild(aliasBtn);
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = t('settings_trust_remove', 'Remove trust');
        btn.onclick = async () => {
            const config = await swarmGetConfig();
            const next = (config.trustedPeers || []).filter(p => p !== peerId);
            await swarmSetConfig({ ...config, trustedPeers: next });
            await loadSettingsData();
        };
        item.appendChild(btn);
        container.appendChild(item);
    });
}

// Prompt para editar alias de un peer ID
async function promptAlias(peerId) {
    const knownNicks = await getKnownNicks();
    const current = knownNicks?.aliases?.[peerId] || '';
    const newAlias = prompt(t('settings_alias_prompt', 'Alias for this peer:'), current);
    if (newAlias === null) return; // cancelado
    await setNickAlias(peerId, newAlias.trim());
    await loadSettingsData();
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
    const systemChannels = await getSystemChannels();
    if (!channels.length) { setVisible(empty, true); return; }
    setVisible(empty, false);
    channels.sort((a, b) => a.name.localeCompare(b.name));
    channels.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';

        const isSystem = systemChannels.includes(ch.name);
        const isOwner = ch.creatorPeerId === myPeerId && !isSystem;

        // Badge + nombre
        const infoSpan = document.createElement('span');
        if (isSystem) {
            infoSpan.textContent = '🌐 ';
        } else if (ch.passwordHash) {
            infoSpan.textContent = '🔒 ';
        } else {
            infoSpan.textContent = '🔓 ';
        }
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = `#${ch.displayName || ch.name}`;
        infoSpan.appendChild(nameStrong);

        // Badge
        const badge = document.createElement('span');
        badge.className = 'settings-channel-badge';
        if (isSystem) {
            badge.textContent = t('settings_channel_badge_public', 'Public');
            badge.classList.add('badge-public');
        } else if (isOwner) {
            badge.textContent = t('settings_channel_badge_owner', 'Owner');
            badge.classList.add('badge-owner');
        } else {
            badge.textContent = t('settings_channel_badge_private', 'Private');
            badge.classList.add('badge-private');
        }
        infoSpan.appendChild(badge);
        item.appendChild(infoSpan);

        // Owner: botones de cambiar contraseña y eliminar
        if (isOwner) {
            const changePwdBtn = document.createElement('button');
            changePwdBtn.className = 'settings-action-btn';
            changePwdBtn.textContent = '🔑';
            changePwdBtn.title = t('settings_channel_change_password', 'Change password');
            changePwdBtn.onclick = async () => {
                const newPwd = prompt(t('settings_channel_new_password_prompt', 'Enter new password:'));
                if (!newPwd) return;
                try {
                    await changeChannelPassword(ch.name, newPwd);
                    alert(t('channel_password_changed', 'Password changed.'));
                } catch (err) {
                    alert(err.message);
                }
            };
            item.appendChild(changePwdBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'settings-remove-btn';
            delBtn.textContent = '✕';
            delBtn.title = t('settings_delete_channel', 'Delete channel');
            delBtn.onclick = async () => {
                const msg = (t('settings_delete_channel_confirm', `Delete channel "${ch.name}"?`)).replace('{name}', ch.name);
                if (!confirm(msg)) return;
                try {
                    await deleteChannel(ch.name);
                    await renderChannels(myPeerId);
                } catch (err) {
                    alert(err.message);
                }
            };
            item.appendChild(delBtn);
        }

        container.appendChild(item);
    });
}


function switchTab(tabName) {
    $$('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === tabName));
    $$('.settings-panel').forEach(p => {
        p.classList.toggle('active', p.id === `settings-panel-${tabName}`);
    });
}

// Init — cargar datos cuando se activa la tab de settings
function initSettings() {
    // Cargar datos cuando se muestra la tab de settings
    const settingsTab = document.querySelector('.app-tab[data-tab="settings"]');
    if (settingsTab) {
        const observer = new MutationObserver(() => {
            const panel = $('#panel-settings');
            if (panel && panel.classList.contains('active')) {
                loadSettingsData();
            }
        });
        const panel = $('#panel-settings');
        if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }

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

    $('#settings-restart-p2p')?.addEventListener('click', async () => {
        const btn = $('#settings-restart-p2p');
        btn.disabled = true;
        btn.textContent = '...';
        await swarmRestart();
        btn.textContent = '✓';
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = t('settings_restart_p2p', 'Restart P2P');
        }, 1500);
    });

    // Autostart checkbox
    const autostartEl = $('#settings-autostart');
    if (autostartEl) {
        getAutostart().then(enabled => { autostartEl.checked = !!enabled; });
        autostartEl.addEventListener('change', () => {
            setAutostart(autostartEl.checked);
        });
    }

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

    $('#settings-add-blocked-btn')?.addEventListener('click', async () => {
        const input = $('#settings-add-blocked-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        await blockAuthor(peerId);
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-add-trust-btn')?.addEventListener('click', async () => {
        const input = $('#settings-trust-peer-id-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        const config = await swarmGetConfig();
        const current = config.trustedPeers || [];
        if (!current.includes(peerId)) {
            await swarmSetConfig({ ...config, trustedPeers: [...current, peerId] });
        }
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-activate-channel-btn')?.addEventListener('click', async () => {
        const keyInput = $('#settings-channel-key-input');
        const pwdInput = $('#settings-channel-password-input');
        const displayNameInput = $('#settings-channel-display-name-input');
        const key = keyInput.value.trim();
        const password = pwdInput.value.trim();
        const displayName = displayNameInput.value.trim();
        if (!key || !password) {
            alert(t('settings_channel_activate_missing', 'Enter both the key and a password.'));
            return;
        }
        try {
            await activateChannel(key, password, displayName);
            keyInput.value = '';
            pwdInput.value = '';
            displayNameInput.value = '';
            const status = await swarmStatus();
            await renderChannels(status.peerId || '');
            alert(t('channel_activated_ok', 'Channel activated successfully.'));
        } catch (err) {
            alert(err.message);
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

// Llamar init cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
} else {
    initSettings();
}

