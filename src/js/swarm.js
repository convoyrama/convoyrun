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
    'filter-game':   { all: 'swarm_filter_all', ATS: 'swarm_game_ats', ETS2: 'swarm_game_ets2' },
    'filter-mode':   { all: 'swarm_filter_all', simulation: 'swarm_mode_simulation', realistic: 'swarm_mode_realistic', arcade: 'swarm_mode_arcade' },
    'filter-author': { all: 'swarm_filter_all', trusted: 'swarm_filter_trusted' },
    'filter-score':  { all: 'swarm_filter_all', positive: 'swarm_filter_positive' },
    'filter-order':  { time: 'swarm_filter_order_time', reputation: 'swarm_filter_order_rep' },
    'filter-channel': { all: 'swarm_channel_filter_all' },
    'filter-language': { all: 'swarm_filter_all' },
};

let convoys = [];
let votes = {};
let myVotes = {};
let config = {};
let nodeMode = 'local';
let myPeerId = '';
let lang = 'en';
let showAllDays = false;
let selectedDayKey = null;
let blockedAuthorsSet = new Set();
let _autoRefreshInterval = null;

let listEl, emptyEl, emptyFilteredEl, statusEl, dayBarEl, loadingEl;

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

function setStatusLabel() {
    let text = label('swarm_status_offline', 'Offline');
    if (nodeMode === 'online') text = label('swarm_status_online', 'Nodo online');
    statusEl.textContent = text;
    statusEl.dataset.mode = nodeMode;
    statusEl.title = label('swarm_status_title', 'Estado del nodo');
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
        language: val('filter-language'),
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
    if (f.language !== 'all') out = out.filter(c => (c.event.languages || []).includes(f.language));
    out = out.filter(c => !isOffensive(c));
    return out;
}

const OFFENSIVE_PATTERNS = /\b(spam|scam|hack|cheat|free.?coins|click.?here|buy.?followers)\b/i;
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

function dayChipLabel(dayKey, nowTs) {
    if (dayKey === dayKeyUTC(nowTs)) return label('swarm_day_today', 'Hoy');
    if (dayKey === dayKeyUTC(nowTs + 86400)) return label('swarm_day_tomorrow', 'Mañana');
    return DateTime.fromISO(dayKey, { zone: 'UTC' }).toFormat('EEE d', { locale: lang });
}

function renderDayBar(dayKeys) {
    if (!dayBarEl) return;
    dayBarEl.innerHTML = '';

    const soonChip = el('button', 'swarm-day-chip' + (selectedDayKey === null ? ' active' : ''),
        showAllDays ? label('swarm_day_all', 'Todos') : label('swarm_day_soon', 'Próximos'));
    soonChip.type = 'button';
    soonChip.addEventListener('click', () => {
        selectedDayKey = null;
        renderAll();
    });
    dayBarEl.appendChild(soonChip);

    for (const day of dayKeys) {
        const chip = el('button', 'swarm-day-chip' + (selectedDayKey === day ? ' active' : ''), dayChipLabel(day, nowUnix()));
        chip.type = 'button';
        chip.title = DateTime.fromISO(day, { zone: 'UTC' }).toLocaleString(DateTime.DATE_FULL, { locale: lang });
        chip.addEventListener('click', () => {
            selectedDayKey = selectedDayKey === day ? null : day;
            renderAll();
        });
        dayBarEl.appendChild(chip);
    }
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
        if (c.peerId === 'local-user') {
            showCopyMessage(label('swarm_vote_self', 'No podés votar tu propio convoy.'));
            return;
        }
        await swarmVote(c.id, dir);
        await renderAll();
    });
    return b;
}

function toggleExpand(wrap) {
    const details = wrap.querySelector('.swarm-row-details');
    const caret = wrap.querySelector('.swarm-row-caret');
    const open = !details.hidden;
    details.hidden = open;
    wrap.classList.toggle('open', !open);
    caret.textContent = open ? '▶' : '▼';
}

function buildEvent(c) {
    const wrap = el('div', 'swarm-event');

    const row = el('div', 'swarm-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.title = label('swarm_row_toggle', 'Ver detalles');
    row.addEventListener('click', () => toggleExpand(wrap));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(wrap); }
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

    if (c.peerId && c.peerId !== myPeerId) {
        const blockBtn = el('button', 'swarm-block-btn', '🚫');
        blockBtn.title = 'Block author';
        blockBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await blockAuthor(c.peerId);
            await renderAll();
        });
        author.appendChild(blockBtn);

        const reportBtn = el('button', 'swarm-report-btn', '⚠️');
        reportBtn.title = label('swarm_report', 'Reportar evento');
        reportBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const reason = prompt(label('swarm_report_reason', 'Motivo del reporte:'));
            if (!reason) return;
            try {
                const { swarmReport } = await import('./native/tauri-bridge.js');
                await swarmReport(c.id, c.peerId, reason);
                showCopyMessage(label('swarm_report_ok', 'Evento reportado. Gracias.'));
            } catch (err) {
                console.error('[SWARM-REPORT] Failed:', err);
                showCopyMessage(label('swarm_report_fail', 'Error al reportar.'));
            }
        });
        author.appendChild(reportBtn);
    }

    if (c.peerId && c.peerId === myPeerId) {
        const deleteBtn = el('button', 'swarm-delete-btn',
            label('swarm_delete', 'Eliminar'));
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(label('swarm_delete_confirm', '¿Eliminar este convoy? No se puede deshacer.'))) return;
            await swarmDelete(c.id);
            await renderAll();
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
    console.log('[SWARM] renderList:', { total: convoys.length, filtered: filtered.length, showEmpty, showFiltered, showAllDays });

    setVisible(emptyEl, showEmpty, 'block');
    setVisible(emptyFilteredEl, showFiltered, 'block');

    const groups = new Map();
    for (const c of filtered) {
        const k = dayKeyUTC(c.schedule.meetingTimestamp);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
    }

    const dayKeys = [...groups.keys()].sort();
    if (selectedDayKey && !dayKeys.includes(selectedDayKey)) selectedDayKey = null;
    if (dayBarEl) setVisible(dayBarEl, !(showEmpty || showFiltered), 'flex');
    renderDayBar(dayKeys);

    const nowTs = nowUnix();
    const today = dayKeyUTC(nowTs);
    const tomorrow = dayKeyUTC(nowTs + 86400);
    const inRange = day => showAllDays || day === today || day === tomorrow;

    let visibleDays;
    if (selectedDayKey) {
        visibleDays = [selectedDayKey];
    } else {
        visibleDays = dayKeys.filter(inRange);
    }

    const toggleEl = document.getElementById('swarm-range-toggle');
    const hintEl = document.getElementById('swarm-range-hint');
    if (toggleEl) {
        setVisible(toggleEl, !(showEmpty || showFiltered || selectedDayKey), 'inline-block');
        toggleEl.textContent = showAllDays
            ? label('swarm_range_fewer', 'Solo hoy y mañana')
            : label('swarm_range_more', 'Ver próximos días');
    }
    const noRangeContent = !showEmpty && !showFiltered && filtered.length > 0 && visibleDays.length === 0;
    if (hintEl) setVisible(hintEl, noRangeContent, 'block');

    setVisible(listEl, !(showEmpty || showFiltered || noRangeContent), 'block');
    listEl.innerHTML = '';

    for (const day of visibleDays) {
        listEl.appendChild(buildDayHeader(day));
        groups.get(day).forEach(c => listEl.appendChild(buildEvent(c)));
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

const LANG_LABELS = {
    es: 'swarm_lang_es', en: 'swarm_lang_en', pt: 'swarm_lang_pt',
    fr: 'swarm_lang_fr', de: 'swarm_lang_de', it: 'swarm_lang_it', nl: 'swarm_lang_nl',
};

function updateLanguageFilter() {
    const sel = document.getElementById('filter-language');
    if (!sel) return;
    const langs = [...new Set(convoys.flatMap(c => c.event.languages || []).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '';
    const allOpt = el('option', 'swarm_filter_all', label('swarm_filter_all', 'Todos'));
    allOpt.value = 'all';
    sel.appendChild(allOpt);
    for (const l of langs) {
        const opt = el('option', '', label(LANG_LABELS[l] || '', l.toUpperCase()));
        opt.value = l;
        sel.appendChild(opt);
    }
    sel.value = current || 'all';
}

async function renderAll() {
    console.log('[SWARM] renderAll called');
    if (loadingEl) setVisible(loadingEl, true, 'flex');
    if (listEl) setVisible(listEl, false);
    const [c, v, my, cfg, blacklists] = await Promise.all([
        swarmList(), swarmGetVotes(), swarmGetMyVotes(), swarmGetConfig(),
        getPublicBlacklists(),
    ]);
    console.log('[SWARM] renderAll raw data:', {
        listCount: Array.isArray(c) ? c.length : 'not-array',
        votesCount: v ? Object.keys(v).length : 0,
    });
    convoys = (Array.isArray(c) ? c : []).filter(validateConvoy);
    console.log('[SWARM] After validateConvoy filter:', convoys.length, 'convoys remain');
    if (convoys.length === 0 && Array.isArray(c) && c.length > 0) {
        console.warn('[SWARM] All convoys rejected by validateConvoy! First convoy:', JSON.stringify(c[0]).slice(0, 500));
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
    updateLanguageFilter();
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
    statusEl = document.getElementById('swarm-node-status');
    dayBarEl = document.getElementById('swarm-daybar');
    loadingEl = document.getElementById('swarm-loading');
    if (!listEl || !emptyEl) return () => {};

    populateFilterLabels();

    document.querySelectorAll('#swarm-filters select').forEach(sel => sel.addEventListener('change', renderAll));

    const toggleEl = document.getElementById('swarm-range-toggle');
    if (toggleEl) toggleEl.addEventListener('click', () => { showAllDays = !showAllDays; renderAll(); });

    window.addEventListener('languageChanged', (e) => {
        lang = e.detail.lang || 'en';
        populateFilterLabels();
        setStatusLabel();
        renderAll();
    });

    (async () => {
        console.log('[SWARM] Initializing P2P...');
        const s = await swarmInit();
        console.log('[SWARM] P2P init result:', s);
        nodeMode = s.mode;
        myPeerId = s.peerId || '';
        setStatusLabel();
        await renderAll();
    })();

    // Auto-refresh cada 60 segundos cuando el nodo está online
    if (_autoRefreshInterval) clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = setInterval(async () => {
        if (nodeMode === 'online') {
            await renderAll();
        }
    }, 60000);

    return renderAll;
}
