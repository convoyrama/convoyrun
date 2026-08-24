// Panel de perfil de autor: muestra eventos, reputación y acciones de moderación.
import * as state from './core/state.js';
import { showCopyMessage, setVisible } from './core/utils.js';
import { reputationBadge, computeScore } from './core/convoy.js';
import {
    getAuthorProfile, blockAuthor, unblockAuthor,
    addFriend, removeFriend, importBlacklist,
    copyToClipboard,
} from './native/tauri-bridge.js';

const { DateTime } = luxon;

function t(key, fallback) {
    return (window.__convoyrunLangData && window.__convoyrunLangData[key]) || fallback;
}

function truncPeer(id) {
    if (!id || id.length < 16) return id || '—';
    return id.slice(0, 8) + '…' + id.slice(-6);
}

let overlay = null;
let currentPeerId = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function modeLabel(mode) {
    return t({ simulation: 'swarm_mode_simulation', realistic: 'swarm_mode_realistic', arcade: 'swarm_mode_arcade' }[mode], mode);
}

function buildOverlay() {
    if (overlay) return;
    overlay = el('div', 'about-overlay');
    overlay.id = 'author-profile-overlay';
    overlay.hidden = true;

    const modal = el('div', 'about-modal author-profile-modal');

    const closeBtn = el('button', 'about-close', '×');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeProfile);
    modal.appendChild(closeBtn);

    const header = el('div', 'author-profile-header');
    header.innerHTML = `
        <div class="author-profile-nick" id="ap-nick"></div>
        <div class="author-profile-peer" id="ap-peer"></div>
        <div class="author-profile-rep" id="ap-rep"></div>
    `;
    modal.appendChild(header);

    const actions = el('div', 'author-profile-actions');
    actions.id = 'ap-actions';
    modal.appendChild(actions);

    const convoyList = el('div', 'author-profile-convoys');
    convoyList.id = 'ap-convoys';
    modal.appendChild(convoyList);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeProfile(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && !overlay.hidden) closeProfile(); });
    document.body.appendChild(overlay);
}

function closeProfile() {
    if (!overlay) return;
    overlay.hidden = true;
    currentPeerId = null;
}

async function openProfile(peerId) {
    if (!peerId) return;
    buildOverlay();
    currentPeerId = peerId;
    setVisible(overlay, true, 'flex');

    const nickEl = document.getElementById('ap-nick');
    const peerEl = document.getElementById('ap-peer');
    const repEl = document.getElementById('ap-rep');
    const actionsEl = document.getElementById('ap-actions');
    const convoysEl = document.getElementById('ap-convoys');

    nickEl.textContent = '…';
    peerEl.textContent = truncPeer(peerId);
    repEl.innerHTML = '';
    actionsEl.innerHTML = '';
    convoysEl.innerHTML = '';

    const profile = await getAuthorProfile(peerId);
    if (!profile || currentPeerId !== peerId) return;

    nickEl.textContent = profile.nickname || truncPeer(peerId);

    peerEl.textContent = truncPeer(peerId);
    peerEl.title = t('ap_copy_peer', 'Click para copiar');
    peerEl.onclick = async () => {
        await copyToClipboard(peerId);
        showCopyMessage(t('ap_peer_copied', 'Peer ID copiado.'));
    };

    const rep = profile.reputation || 0;
    const dot = el('span', `rep-dot rep-${reputationBadge(rep)}`);
    dot.title = t('swarm_score_label', 'Puntaje');
    repEl.appendChild(dot);
    repEl.appendChild(document.createTextNode(` ${rep} · ${profile.convoyCount || 0} ${t('ap_events', 'eventos')}`));

    const isMe = false;

    if (!isMe) {
        const blockBtn = el('button', 'settings-action-btn' + (profile.isBlocked ? ' active' : ''),
            profile.isBlocked ? t('ap_unblock', 'Desbloquear') : t('ap_block', 'Bloquear'));
        blockBtn.addEventListener('click', async () => {
            if (profile.isBlocked) {
                await unblockAuthor(peerId);
            } else {
                await blockAuthor(peerId);
            }
            await openProfile(peerId);
        });
        actionsEl.appendChild(blockBtn);

        const friendBtn = el('button', 'settings-action-btn' + (profile.isFriend ? ' active' : ''),
            profile.isFriend ? t('ap_remove_friend', 'Quitar amigo') : t('ap_add_friend', 'Agregar amigo'));
        friendBtn.addEventListener('click', async () => {
            if (profile.isFriend) {
                await removeFriend(peerId);
            } else {
                await addFriend(peerId);
            }
            await openProfile(peerId);
        });
        actionsEl.appendChild(friendBtn);

        const mergeBtn = el('button', 'settings-action-btn', t('ap_merge_blacklist', 'Importar bloqueos'));
        mergeBtn.title = t('ap_merge_blacklist_title', 'Agregar los bloqueos de este usuario a mi lista');
        mergeBtn.addEventListener('click', async () => {
            const ok = await importBlacklist(peerId);
            if (ok) {
                showCopyMessage(t('ap_merge_blacklist_ok', 'Lista negra importada.'));
            }
        });
        actionsEl.appendChild(mergeBtn);
    }

    if (profile.convoys && profile.convoys.length) {
        const now = Math.floor(Date.now() / 1000);
        for (const c of profile.convoys) {
            const row = el('div', 'author-profile-convoy');
            const meeting = DateTime.fromSeconds(c.meetingTimestamp);
            const timeStr = meeting.toFormat('EEE d MMM · HH:mm', { locale: state.currentLang || 'es' });
            row.appendChild(el('span', 'ap-convoy-time', timeStr));
            row.appendChild(el('span', 'ap-convoy-name', c.name));
            row.appendChild(el('span', 'ap-convoy-game', `${c.game} · ${modeLabel(c.mode)}`));
            const score = c.score || 0;
            row.appendChild(el('span', 'ap-convoy-score' + (score > 0 ? ' positive' : score < 0 ? ' negative' : ''), score > 0 ? `+${score}` : String(score)));
            convoysEl.appendChild(row);
        }
    } else {
        convoysEl.appendChild(el('p', 'ap-no-convoys', t('ap_no_convoys', 'No hay eventos vigentes de este autor.')));
    }
}

export function initAuthorProfile() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('.clickable-author');
        if (target) {
            const peerId = target.dataset.peerId;
            if (peerId) openProfile(peerId);
        }
    });
}

export { openProfile, closeProfile };
