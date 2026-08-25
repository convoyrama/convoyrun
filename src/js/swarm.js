// Lector del calendario Swarm: lista del día en una línea por evento (colapsada,
// se expande al hacer click), votos ↑/↓, filtros (juego, modo, confianza,
// ocultar negativos, orden) y lista de confianza local. Por defecto muestra solo
// los convoys de HOY y MAÑANA; se puede ampliar a todos los días. En modo demo
// (sin backend iroh) sirve la caché local.
import * as state from './core/state.js';
import { showCopyMessage, setVisible } from './core/utils.js';
import {
    dayKeyUTC, computeScore, authorReputation, reputationBadge,
    validateConvoy, nowUnix,
} from './core/convoy.js';
import {
    swarmInit, swarmList, swarmGetVotes, swarmGetMyVotes, swarmVote,
    swarmGetConfig, swarmSetConfig, swarmStatus, swarmPublish,
    swarmDelete, blockAuthor, getPublicBlacklists,
} from './native/tauri-bridge.js';

const { DateTime } = luxon;

const FILTER_LABELS = {
    'filter-game':   { all: 'swarm_filter_all', ATS: 'swarm_game_ats', ETS2: 'swarm_game_ets2', other: 'swarm_filter_other' },
    'filter-mode':   { all: 'swarm_filter_all', simulation: 'swarm_mode_simulation', realistic: 'swarm_mode_realistic', arcade: 'swarm_mode_arcade', other: 'swarm_filter_other' },
    'filter-author': { all: 'swarm_filter_all', trusted: 'swarm_filter_trusted' },
    'filter-score':  { all: 'swarm_filter_all', positive: 'swarm_filter_positive' },
    'filter-order':  { time: 'swarm_filter_order_time', reputation: 'swarm_filter_order_rep' },
    'filter-channel': { all: 'swarm_channel_filter_all' },
};

let convoys = [];
let votes = {};
let myVotes = {};
let config = {};
let nodeMode = 'local';
let myPeerId = '';
let lang = 'en';
let blockedAuthorsSet = new Set();
let _autoRefreshInterval = null;
let expandedConvoyId = null;

let listEl, emptyEl, emptyFilteredEl, loadingEl;

function label(key, fallback) {
    return state.currentLangData[key] || fallback;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showFlyerLightbox(src, alt) {
    let overlay = document.getElementById('flyer-lightbox');
    if (!overlay) {
        overlay = el('div', 'flyer-lightbox-overlay');
        overlay.id = 'flyer-lightbox';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;';
        const img = el('img');
        img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
        overlay.appendChild(img);
        const closeBtn = el('button', '', '✕');
        closeBtn.style.cssText = 'position:absolute;top:16px;right:24px;background:none;border:none;color:#fff;font-size:2rem;cursor:pointer;';
        overlay.appendChild(closeBtn);
        const close = () => { setVisible(overlay, false); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === closeBtn) close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        document.body.appendChild(overlay);
    }
    const img = overlay.querySelector('img');
    img.src = src;
    img.alt = alt;
    setVisible(overlay, true, 'flex');
}

function modeLabel(mode) {
    return label({ simulation: 'swarm_mode_simulation', realistic: 'swarm_mode_realistic', arcade: 'swarm_mode_arcade' }[mode], mode);
}

function populateFilterLabels() {
    for (const [selId, map] of Object.entries(FILTER_LABELS)) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        Array.from(sel.options).forEach(opt => {
            const key = map[opt.value];
            if (key) opt.textContent = label(key, opt.textContent);
        });
    }
}

function readFilters() {
    const val = id => { const s = document.getElementById(id); return s ? s.value : 'all'; };
    return {
        game: val('filter-game'),
        mode: val('filter-mode'),
        trust: val('filter-author'),
        score: val('filter-score'),
        order: val('filter-order'),
        channel: val('filter-channel'),
        language: 'all',
    };
}

function applyFilters(list) {
    const f = readFilters();
    let out = [...list];
    if (blockedAuthorsSet.size > 0) out = out.filter(c => !blockedAuthorsSet.has(c.peerId));
    if (f.game !== 'all') out = out.filter(c => c.event.game === f.game);
    if (f.mode !== 'all') out = out.filter(c => c.event.mode === f.mode);
    if (f.trust === 'trusted') out = out.filter(c => (config.trustedPeers || []).includes(c.peerId));
    if (f.score === 'positive') out = out.filter(c => computeScore(votes[c.id]) >= 0);
    if (f.channel !== 'all') out = out.filter(c => c.channel === f.channel);
    // Filtrar por idiomas seleccionados en Settings (defaultLanguages)
    const allowedLangs = config.defaultLanguages || [];
    if (allowedLangs.length > 0) {
        out = out.filter(c => {
            const cLangs = c.event.languages || [];
            if (cLangs.length === 0) return true; // eventos sin idioma siempre visibles
            return cLangs.some(l => allowedLangs.includes(l));
        });
    }
    out = out.filter(c => !isOffensive(c));
    return out;
}

const OFFENSIVE_PATTERNS = /\b(spam|scam|hack|cheat|free.?coins|click.?here|buy.?followers|estafa|robo|hackeo|monedas.?gratis|golpistas|hack\.\w+\.\w+)\b/i;
function isOffensive(c) {
    const text = `${c.event.name || ''} ${c.event.description || ''}`;
    return OFFENSIVE_PATTERNS.test(text);
}

function sortList(list) {
    const f = readFilters();
    const rep = {};
    for (const c of list) rep[c.peerId] = authorReputation(list, votes, c.peerId);
    return [...list].sort((a, b) => {
        if (f.order === 'reputation') {
            const r = (rep[b.peerId] || 0) - (rep[a.peerId] || 0);
            if (r !== 0) return r;
        }
        return a.schedule.meetingTimestamp - b.schedule.meetingTimestamp;
    });
}

function buildDayHeader(dayKey) {
    const dt = DateTime.fromISO(dayKey, { zone: 'UTC' });
    const nowTs = nowUnix();
    let title;
    if (dayKey === dayKeyUTC(nowTs)) title = label('swarm_day_today', 'Hoy');
    else if (dayKey === dayKeyUTC(nowTs + 86400)) title = label('swarm_day_tomorrow', 'Mañana');
    else title = dt.toLocaleString(DateTime.DATE_FULL, { locale: lang });
    return el('div', 'swarm-day', title);
}

function formatMeetingTime(c) {
    return DateTime.fromSeconds(c.schedule.meetingTimestamp).toFormat('EEEE d · HH:mm', { locale: lang });
}

function creatorZoneLabel(c) {
    const zt = DateTime.fromSeconds(c.schedule.meetingTimestamp, { zone: c.schedule.ianaTimeZone });
    const zoneName = zt.offsetNameShort || c.schedule.ianaTimeZone;
    return `${zt.toFormat('HH:mm')} (${zoneName})`;
}

function buildVoteBtn(c, dir) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swarm-vote-btn' + (myVotes[c.id] === dir ? ' active' : '');
    b.textContent = dir === 1 ? '▲' : '▼';
    b.title = label(dir === 1 ? 'swarm_vote_up_title' : 'swarm_vote_down_title', dir === 1 ? 'Votar a favor' : 'Votar en contra');
    b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (c.peerId === myPeerId) {
            showCopyMessage(label('swarm_vote_self', 'No podés votar tu propio convoy.'));
            return;
        }
        await swarmVote(c.id, dir);
        await renderAll();
    });
    return b;
}

function toggleExpand(wrap, convoyId) {
    const details = wrap.querySelector('.swarm-row-details');
    const caret = wrap.querySelector('.swarm-row-caret');
    const wasOpen = !details.hidden;
    details.hidden = wasOpen;
    wrap.classList.toggle('open', !wasOpen);
    caret.textContent = wasOpen ? '▶' : '▼';
    expandedConvoyId = wasOpen ? null : convoyId;
}

function buildEvent(c) {
    const wrap = el('div', 'swarm-event');
    wrap.dataset.convoyId = c.id;

    const row = el('div', 'swarm-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.title = label('swarm_row_toggle', 'Ver detalles');
    row.addEventListener('click', () => toggleExpand(wrap, c.id));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(wrap, c.id); }
    });

    row.appendChild(el('span', 'swarm-row-caret', '▶'));

    const badges = el('div', 'swarm-badges');
    badges.appendChild(el('span', 'swarm-badge swarm-badge-game', c.event.game));
    badges.appendChild(el('span', `swarm-badge swarm-badge-mode swarm-mode-${c.event.mode}`, modeLabel(c.event.mode)));
    if (c.channel) {
        badges.appendChild(el('span', 'swarm-badge swarm-badge-channel', c.channel));
    }
    if (c.event.languages && c.event.languages.length) {
        const langText = c.event.languages.map(l => l.toUpperCase()).join(' ');
        badges.appendChild(el('span', 'swarm-badge swarm-badge-lang', langText));
    }
    row.appendChild(badges);

    row.appendChild(el('span', 'swarm-row-time', DateTime.fromSeconds(c.schedule.meetingTimestamp).toFormat('HH:mm')));

    row.appendChild(el('span', 'swarm-row-name', c.event.name));

    const authorSpan = el('span', 'swarm-row-author clickable-author', c.nickname || c.peerId || '?');
    authorSpan.dataset.peerId = c.peerId;
    authorSpan.title = c.peerId;
    row.appendChild(authorSpan);

    const votesBox = el('div', 'swarm-votes');
    votesBox.appendChild(buildVoteBtn(c, 1));
    votesBox.appendChild(el('span', 'swarm-score', String(computeScore(votes[c.id]))));
    votesBox.appendChild(buildVoteBtn(c, -1));
    row.appendChild(votesBox);

    wrap.appendChild(row);

    const details = el('div', 'swarm-row-details');
    details.hidden = true;

    if (c.flyer && c.flyer.thumb) {
        const img = el('img', 'swarm-flyer-thumb');
        img.src = c.flyer.thumb;
        img.alt = c.event.name;
        img.style.cursor = 'pointer';
        img.title = label('swarm_flyer_zoom', 'Click para ver en grande');
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            showFlyerLightbox(c.flyer.originalUrl || c.flyer.thumb, c.event.name);
        });
        details.appendChild(img);
    }

    const info = el('div', 'swarm-row-info');

    info.appendChild(el('div', 'swarm-detail-name', c.event.name));

    info.appendChild(el('div', 'swarm-detail-kicker', label('swarm_detail_when', 'Cuándo')));
    info.appendChild(el('div', 'swarm-detail-time', formatMeetingTime(c)));
    if (c.schedule.ianaTimeZone && c.schedule.ianaTimeZone !== DateTime.local().zoneName) {
        info.appendChild(el('div', 'swarm-detail-zone', `${label('swarm_creator_zone', 'Zona del creador')}: ${creatorZoneLabel(c)}`));
    }

    info.appendChild(el('div', 'swarm-detail-kicker', label('swarm_detail_author', 'Autor')));
    const author = el('div', 'swarm-detail-author');
    const rep = authorReputation(convoys, votes, c.peerId);
    const dot = el('span', `rep-dot rep-${reputationBadge(rep)}`);
    dot.title = label('swarm_score_label', 'Puntaje');
    author.appendChild(dot);
    const nickSpan = el('span', 'swarm-card-nick clickable-author', c.nickname || c.peerId || '?');
    nickSpan.dataset.peerId = c.peerId;
    nickSpan.title = c.peerId;
    author.appendChild(nickSpan);
    if (c.peerId && c.peerId !== myPeerId) {
        if ((config.trustedPeers || []).includes(c.peerId)) {
            author.appendChild(el('span', 'swarm-trusted-badge', label('swarm_author_trusted', 'confianza')));
        }
        const trustBtn = el('button', 'swarm-trust-btn',
            (config.trustedPeers || []).includes(c.peerId) ? label('swarm_trust_remove', 'Quitar confianza') : label('swarm_trust_add', 'Confiar'));
        trustBtn.addEventListener('click', async () => {
            const list = config.trustedPeers || [];
            const next = list.includes(c.peerId) ? list.filter(p => p !== c.peerId) : [...list, c.peerId];
            await swarmSetConfig({ ...config, trustedPeers: next });
            await renderAll();
        });
        author.appendChild(trustBtn);
    }

    if (c.peerId && c.peerId !== myPeerId) {
        const blockBtn = el('button', 'swarm-block-btn', '🚫');
        blockBtn.title = label('swarm_block_title', 'Block author');
        blockBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await blockAuthor(c.peerId);
            await renderAll();
        });
        author.appendChild(blockBtn);
    }

    if (c.peerId && c.peerId === myPeerId) {
        const deleteBtn = el('button', 'swarm-delete-btn',
            label('swarm_delete', 'Eliminar'));
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(label('swarm_delete_confirm', '¿Eliminar este convoy? No se puede deshacer.'))) return;
            try {
                await swarmDelete(c.id);
                await renderAll();
            } catch (err) {
                console.error('[SWARM] Delete failed:', err);
                showCopyMessage(label('swarm_delete_fail', 'No se pudo eliminar: ' + (err?.toString() || 'error')));
            }
        });
        author.appendChild(deleteBtn);
    }

    info.appendChild(author);

    const line = [];
    if (c.event.server) line.push(c.event.server);
    const startCity = c.event.route?.startCity || c.event.startPlace || '';
    const destCity = c.event.route?.destCity || c.event.destination || '';
    if (startCity && destCity) line.push(`${startCity} → ${destCity}`);
    else if (startCity) line.push(startCity);
    else if (destCity) line.push(`→ ${destCity}`);
    if (line.length) {
        info.appendChild(el('div', 'swarm-detail-kicker', label('swarm_detail_route', 'Ruta')));
        info.appendChild(el('div', 'swarm-detail-line', line.join(' · ')));
    }
    if (c.event.description) info.appendChild(el('p', 'swarm-detail-desc', c.event.description));

    if (c.event.languages && c.event.languages.length) {
        const langLabel = el('div', 'swarm-detail-kicker', label('swarm_wizard_languages', 'Idiomas'));
        info.appendChild(langLabel);
        const langList = el('div', 'swarm-detail-languages');
        for (const l of c.event.languages) {
            langList.appendChild(el('span', 'swarm-badge swarm-badge-lang', label(LANG_LABELS[l] || '', l.toUpperCase())));
        }
        info.appendChild(langList);
    }

    info.appendChild(el('div', 'swarm-detail-published',
        `${label('swarm_detail_published', 'Publicado')}: ${DateTime.fromSeconds(c.publishedAt).toLocaleString(DateTime.DATE_FULL, { locale: lang })}`));

    details.appendChild(info);
    wrap.appendChild(details);

    return wrap;
}

function renderList() {
    const filtered = sortList(applyFilters(convoys));
    const showEmpty = convoys.length === 0;
    const showFiltered = !showEmpty && filtered.length === 0;
    setVisible(emptyEl, showEmpty, 'block');
    setVisible(emptyFilteredEl, showFiltered, 'block');

    const groups = new Map();
    for (const c of filtered) {
        const k = dayKeyUTC(c.schedule.meetingTimestamp);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
    }

    const dayKeys = [...groups.keys()].sort();

    const nowTs = nowUnix();
    const today = dayKeyUTC(nowTs);
    const tomorrow = dayKeyUTC(nowTs + 86400);

    setVisible(listEl, !(showEmpty || showFiltered), 'block');
    listEl.innerHTML = '';

    for (const day of dayKeys) {
        const header = buildDayHeader(day);
        if (day === today) header.classList.add('swarm-day-today');
        else if (day === tomorrow) header.classList.add('swarm-day-tomorrow');
        listEl.appendChild(header);
        groups.get(day).forEach(c => {
            const wrap = buildEvent(c);
            if (day < today) wrap.classList.add('swarm-event-past');
            else if (day === today) wrap.classList.add('swarm-event-today');
            else if (day === tomorrow) wrap.classList.add('swarm-event-tomorrow');
            listEl.appendChild(wrap);
        });
    }

    if (expandedConvoyId) {
        const expandedWrap = listEl.querySelector(`[data-convoy-id="${expandedConvoyId}"]`)?.closest('.swarm-event');
        if (expandedWrap) toggleExpand(expandedWrap, expandedConvoyId);
    }
}

function updateChannelFilter() {
    const sel = document.getElementById('filter-channel');
    if (!sel) return;
    const channels = [...new Set(convoys.map(c => c.channel).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '';
    const allOpt = el('option', 'swarm_channel_filter_all', label('swarm_channel_filter_all', 'Todos los canales'));
    allOpt.value = 'all';
    sel.appendChild(allOpt);
    for (const ch of channels) {
        const opt = el('option', '', ch);
        opt.value = ch;
        sel.appendChild(opt);
    }
    sel.value = current || 'all';
}



async function renderAll() {
    if (loadingEl) setVisible(loadingEl, true, 'flex');
    if (listEl) setVisible(listEl, false);
    const [c, v, my, cfg, blacklists] = await Promise.all([
        swarmList(), swarmGetVotes(), swarmGetMyVotes(), swarmGetConfig(),
        getPublicBlacklists(),
    ]);
    convoys = (Array.isArray(c) ? c : []).filter(validateConvoy);
    if (convoys.length === 0 && Array.isArray(c) && c.length > 0) {
        console.warn('[SWARM] All convoys rejected by validateConvoy');
    }
    votes = v || {};
    myVotes = my || {};
    config = cfg || {};

    const followed = new Set(config.followedBlacklists || []);
    blockedAuthorsSet = new Set();
    if (followed.size > 0 && Array.isArray(blacklists)) {
        for (const bl of blacklists) {
            if (followed.has(bl.authorPeerId) && Array.isArray(bl.blocked)) {
                for (const pid of bl.blocked) blockedAuthorsSet.add(pid);
            }
        }
    }

    updateChannelFilter();
    if (loadingEl) setVisible(loadingEl, false);
    renderList();
}

let _swarmInitialized = false;
export function initSwarm() {
    if (_swarmInitialized) return;
    _swarmInitialized = true;
    listEl = document.getElementById('swarm-list');
    emptyEl = document.getElementById('swarm-empty');
    emptyFilteredEl = document.getElementById('swarm-empty-filtered');
    loadingEl = document.getElementById('swarm-loading');
    if (!listEl || !emptyEl) return () => {};

    populateFilterLabels();

    document.querySelectorAll('#swarm-filters select').forEach(sel => sel.addEventListener('change', renderAll));

    window.addEventListener('languageChanged', (e) => {
        lang = e.detail.lang || 'en';
        populateFilterLabels();
        renderAll();
    });

    (async () => {
        const s = await swarmInit();
        nodeMode = s.mode;
        myPeerId = s.peerId || '';
        await renderAll();
    })();

    // Retry P2P init every 30s if not yet online
    let _retryInterval = setInterval(async () => {
        if (nodeMode === 'online') { clearInterval(_retryInterval); return; }
        try {
            const s = await swarmInit();
            nodeMode = s.mode;
            myPeerId = s.peerId || '';
            if (nodeMode === 'online') clearInterval(_retryInterval);
        } catch { /* retry later */ }
    }, 30000);

    // Auto-refresh cada 60 segundos cuando el nodo está online
    if (_autoRefreshInterval) clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = setInterval(async () => {
        // Re-query node status to detect state changes (searching → online)
        try {
            const s = await swarmInit();
            nodeMode = s.mode;
            myPeerId = s.peerId || '';
        } catch { /* keep current status */ }
        await renderAll();
    }, 60000);

    // Listen for real-time events from Rust backend
    const tauri = window.__TAURI__;
    if (tauri?.event) {
        tauri.event.listen('convoy-new', () => renderAll());
        tauri.event.listen('vote-new', () => renderAll());
    }

    return renderAll;
}
