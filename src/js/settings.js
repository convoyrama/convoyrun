import {
    swarmStatus, swarmGetConfig, swarmSetConfig,
    blockAuthor, unblockAuthor, addFriend, removeFriend,
    exportIdentity, importIdentity,
    publishBlacklist, importBlacklist, stopFollowingBlacklist,
    getPublicBlacklists,
    swarmListChannels, createChannel, deleteChannel,
} from './native/tauri-bridge.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const overlay = () => $('#settings-overlay');

function truncPeer(id) {
    if (!id || id.length < 16) return id || '—';
    return id.slice(0, 8) + '…' + id.slice(-6);
}

async function loadSettingsData() {
    const [status, config] = await Promise.all([swarmStatus(), swarmGetConfig()]);

    $('#settings-peer-id').textContent = status.peerId || '—';
    $('#settings-nickname').value = config.nickname || '';

    renderBlocked(config.blockedAuthors || []);
    renderFriends(config.friends || []);
    renderFollowed(config.followedBlacklists || []);
    await renderChannels(status.peerId || '');

    const lists = await getPublicBlacklists();
    renderExplore(lists, config.followedBlacklists || []);
}

function renderBlocked(blocked) {
    const container = $('#settings-blocked-list');
    const empty = $('#settings-blocked-empty');
    container.innerHTML = '';
    if (!blocked.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    blocked.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        item.innerHTML = `<code title="${peerId}">${truncPeer(peerId)}</code>`;
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = 'Unblock';
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
    container.innerHTML = '';
    if (!friends.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    friends.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        item.innerHTML = `<code title="${peerId}">${truncPeer(peerId)}</code>`;
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = 'Remove friend';
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
    container.innerHTML = '';
    if (!followed.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    followed.forEach(peerId => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        item.innerHTML = `<code title="${peerId}">${truncPeer(peerId)}</code>`;
        const btn = document.createElement('button');
        btn.className = 'settings-remove-btn';
        btn.textContent = '✕';
        btn.title = 'Stop following';
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
    container.innerHTML = '';
    const followedSet = new Set(followed);
    const available = lists.filter(l => !followedSet.has(l.authorPeerId));
    if (!available.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    available.forEach(list => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const nick = list.authorPeerId ? truncPeer(list.authorPeerId) : 'Unknown';
        const count = list.blocked ? list.blocked.length : 0;
        item.innerHTML = `<span class="settings-nick">${nick}</span><code>${count} blocked</code>`;
        const btn = document.createElement('button');
        btn.className = 'settings-follow-btn';
        btn.textContent = 'Follow';
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
    container.innerHTML = '';
    const channels = await swarmListChannels();
    if (!channels.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    channels.sort((a, b) => a.name.localeCompare(b.name));
    channels.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'settings-list-item';
        const lock = ch.passwordHash ? '🔒' : '🔓';
        const creator = ch.creatorPeerId === myPeerId ? 'You' : truncPeer(ch.creatorPeerId);
        item.innerHTML = `<span>${lock} <strong>${ch.name}</strong></span><code>${creator}</code>`;
        if (ch.creatorPeerId === myPeerId) {
            const btn = document.createElement('button');
            btn.className = 'settings-remove-btn';
            btn.textContent = '✕';
            btn.title = 'Delete channel';
            btn.onclick = async () => {
                if (!confirm(`Delete channel "${ch.name}"?`)) return;
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
    o.style.display = '';          // clear inline display:none so .open class can take effect
    o.classList.add('open');
    loadSettingsData();
}

function closeSettings() {
    const o = overlay();
    o.classList.remove('open');
    o.style.display = 'none';      // re-hide with inline style
    $('#settings-export-options').style.display = 'none';
    $('#settings-import-options').style.display = 'none';
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
        $('#settings-close').addEventListener('click', closeSettings);

    $$('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.settingsTab));
    });

    $('#settings-copy-peer-id').addEventListener('click', async () => {
        const peerId = $('#settings-peer-id').textContent;
        if (peerId && peerId !== '—') {
            try {
                const { copyToClipboard } = await import('./native/tauri-bridge.js');
                await copyToClipboard(peerId);
                $('#settings-copy-peer-id').textContent = '✓';
                setTimeout(() => { $('#settings-copy-peer-id').textContent = 'Copy'; }, 1500);
            } catch { /* fallback: nada */ }
        }
    });

    $('#settings-save-nick').addEventListener('click', async () => {
        const nick = $('#settings-nickname').value.trim();
        const config = await swarmGetConfig();
        config.nickname = nick || null;
        await swarmSetConfig(config);
        $('#settings-save-nick').textContent = '✓';
        setTimeout(() => { $('#settings-save-nick').textContent = 'Save'; }, 1500);
    });

    $('#settings-export-btn').addEventListener('click', () => {
        const opts = $('#settings-export-options');
        opts.style.display = opts.style.display === 'none' ? '' : 'none';
        $('#settings-import-options').style.display = 'none';
    });

    $('#settings-import-btn').addEventListener('click', () => {
        const opts = $('#settings-import-options');
        opts.style.display = opts.style.display === 'none' ? '' : 'none';
        $('#settings-export-options').style.display = 'none';
    });

    $('#settings-export-confirm').addEventListener('click', async () => {
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
            $('#settings-export-confirm').textContent = '✓ Saved';
            setTimeout(() => { $('#settings-export-confirm').textContent = 'Save backup'; }, 2000);
        }
    });

    $('#settings-import-confirm').addEventListener('click', async () => {
        const tauri = window.__TAURI__;
        if (!tauri) return;
        const path = await tauri.dialog.open({
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;
        const password = $('#settings-import-password').value || null;
        const ok = await importIdentity(path, password);
        if (ok) {
            $('#settings-import-confirm').textContent = '✓ Restored';
            setTimeout(() => { $('#settings-import-confirm').textContent = 'Restore backup'; }, 2000);
            await loadSettingsData();
        }
    });

    $('#settings-add-friend-btn').addEventListener('click', async () => {
        const input = $('#settings-add-friend-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        await addFriend(peerId);
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-add-blocked-btn').addEventListener('click', async () => {
        const input = $('#settings-add-blocked-input');
        const peerId = input.value.trim();
        if (!peerId) return;
        await blockAuthor(peerId);
        input.value = '';
        await loadSettingsData();
    });

    $('#settings-create-channel-btn').addEventListener('click', async () => {
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
            alert('Could not create channel. It may already exist.');
        }
    });

    $('#settings-publish-blacklist').addEventListener('click', async () => {
        const ok = await publishBlacklist();
        if (ok) {
            $('#settings-publish-blacklist').textContent = '✓ Published';
            setTimeout(() => {
                const el = $('#settings-publish-blacklist');
                if (el) el.textContent = 'Publish my blacklist';
            }, 2000);
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
