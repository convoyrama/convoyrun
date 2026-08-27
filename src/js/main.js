import { dom } from './dom.js';
import * as state from './core/state.js';
import { updateLiveClocks, getGameTime, getDetailedDayNightIcon, formatDateForDisplay, resolveMeetingDateTime } from './core/time.js';
import { initI18n } from './i18n.js';
import { drawCanvas, initCanvasEventListeners } from './canvas.js';
import { initTimezoneSettings, refreshZoneSettingsUI } from './timezone-picker.js';
import { initTimeSync } from './time-sync.js';
import { initAbout } from './about.js';
import { initStylePicker } from './style-picker.js';
import { initSwarm } from './swarm.js';
import { initSwarmPublish } from './swarm-publish.js';
import { initSlots, recalcTimeline } from './slots.js';
import { initAuthorProfile } from './author-profile.js';
import { performDownload } from './download.js';
import { initFlyerLoad } from './flyer-load.js';
import { initClipboard } from './clipboard.js';
import { initCanvasControls } from './canvas-controls.js';
import { swarmGetConfig, swarmSetConfig } from './native/tauri-bridge.js';

const { DateTime } = luxon;

let _footerInterval = null;
let _clockInterval = null;

function updateInGameTimeEmojis() {
    if (!dom.ingameEmojiDisplay) return;
    const customDateValue = dom.customDate.value;
    const customTimeValue = dom.customTime.value;

    if (!customDateValue || !customTimeValue) {
        dom.ingameEmojiDisplay.textContent = '';
        return;
    }

    const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, dom.manualOffsetSelect.value);

    if (!meetingDateTime.isValid) {
        dom.ingameEmojiDisplay.textContent = '';
        return;
    }

    const meetingGameTime = getGameTime(meetingDateTime.toUTC());
    const meetingEmoji = getDetailedDayNightIcon(meetingGameTime.hours);

    const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
    const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });
    const departureGameTime = getGameTime(departureDateTime.toUTC());
    const departureEmoji = getDetailedDayNightIcon(departureGameTime.hours);

    const arrivalDateTime = departureDateTime.plus({ minutes: 50 });
    const arrivalGameTime = getGameTime(arrivalDateTime.toUTC());
    const arrivalEmoji = getDetailedDayNightIcon(arrivalGameTime.hours);

    dom.ingameEmojiDisplay.textContent = `${meetingEmoji} ${departureEmoji} ${arrivalEmoji}`;
}

window.addEventListener('languageChanged', (e) => {
    const { translations } = e.detail;
    state.setCurrentLangData(translations);

    refreshZoneSettingsUI(() => { drawCanvas(); updateInGameTimeEmojis(); });

    if (dom.customDateDisplay && dom.customDate.value) {
        const d = DateTime.fromISO(dom.customDate.value);
        if (d.isValid) {
            const labelKey = translations.label_selected_date || 'Fecha seleccionada';
            dom.customDateDisplay.textContent = `${labelKey}: ${formatDateForDisplay(d)}`;
        }
    }

    if (dom.textStyle) {
        const currentStyle = dom.textStyle.value;
        Array.from(dom.textStyle.options).forEach(option => {
            const translation = translations[`style_${option.value}`];
            if (translation) option.textContent = translation;
        });
        dom.textStyle.value = currentStyle;
        if (dom.stylePickerToggle) dom.stylePickerToggle.textContent = dom.textStyle.selectedOptions[0].textContent;
    }

    if (dom.orientationToggle) {
        const v = state.getIsVertical();
        dom.orientationToggle.textContent = v
            ? (translations.orientation_vertical || 'Vertical')
            : (translations.orientation_landscape || 'Horizontal');
    }

    drawCanvas();
    updateInGameTimeEmojis();
});

function initTabs() {
    const tabs = Array.from(document.querySelectorAll('.app-tab'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));
    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(p => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
        if (tab.dataset.tab === 'slots') {
            requestAnimationFrame(recalcTimeline);
        }
    }));
}

async function checkNickRequired() {
    const overlay = document.getElementById('nick-required-overlay');
    const input = document.getElementById('nick-required-input');
    const saveBtn = document.getElementById('nick-required-save');
    if (!overlay || !input || !saveBtn) return;

    try {
        const config = await swarmGetConfig();
        if (config.nickname && config.nickname.trim()) return; // Ya tiene nick
    } catch { /* sin backend, continuar */ }

    // Mostrar modal
    overlay.classList.add('visible');
    input.focus();

    return new Promise((resolve) => {
        const save = async () => {
            const nick = input.value.trim();
            if (!nick) {
                input.style.borderColor = '#ff6b6b';
                return;
            }
            try {
                const config = await swarmGetConfig();
                await swarmSetConfig({ ...config, nickname: nick });
                overlay.classList.remove('visible');
                resolve();
            } catch (err) {
                console.error('[INIT] Failed to save nick:', err);
                input.style.borderColor = '#ff6b6b';
                // No cerrar el modal si falló el guardado
            }
        };

        saveBtn.addEventListener('click', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') save();
        });
    });
}

async function init() {
    initI18n();
    initTabs();

    // Verificar nick obligatorio
    await checkNickRequired();

    dom.customDate = document.getElementById("custom-date");
    dom.customTime = document.getElementById("custom-time");
    dom.customEventName = document.getElementById("custom-event-name");
    dom.customEventLink = document.getElementById("custom-event-link");
    dom.customStartCity = document.getElementById("custom-start-city");
    dom.customStartLocation = document.getElementById("custom-start-location");
    dom.customDestCity = document.getElementById("custom-dest-city");
    dom.customDestLocation = document.getElementById("custom-dest-location");
    dom.customStartPlace = dom.customStartCity;
    dom.customDestination = dom.customDestCity;
    dom.customServer = document.getElementById("custom-server");
    dom.customEventDescription = document.getElementById("custom-event-description");
    dom.loadFlyerInput = document.getElementById("load-flyer-input");
    dom.departureTimeOffset = document.getElementById("departure-time-offset");
    dom.localTimeDisplay = document.getElementById("local-time-display");
    dom.gameTimeDisplay = document.getElementById("game-time-display");
    dom.gameTimeEmoji = document.getElementById("game-time-emoji");
    dom.ingameEmojiDisplay = document.getElementById("ingame-emoji-display");
    dom.manualOffsetSelect = document.getElementById("manual-offset-select");
    dom.customDateDisplay = document.getElementById("custom-date-display");

    dom.copyMessage = document.getElementById("copy-message");
    dom.copyCustomInfo = document.getElementById("copy-custom-info");
    dom.copyTmpBtn = document.getElementById("copy-tmp-btn");
    dom.tmpImagesToggle = document.getElementById("tmp-images-toggle");
    dom.mapCanvas = document.getElementById("map-canvas");
    dom.circleCanvasTop = document.getElementById("circle-canvas-top");
    dom.circleCanvasBottom = document.getElementById("circle-canvas-bottom");
    dom.circleCanvasWaypoint = document.getElementById("circle-canvas-waypoint");
    dom.downloadCanvas = document.getElementById("download-canvas");
    dom.canvasSize = document.getElementById("canvas-size");
    dom.canvasContainer = document.querySelector(".canvas-container");
    dom.orientationToggle = document.getElementById("orientation-toggle");
    dom.waypointToggle = document.getElementById("waypoint-toggle");
    dom.departureToggle = document.getElementById("departure-toggle");
    dom.destinationToggle = document.getElementById("destination-toggle");
    dom.textSize = document.getElementById("text-size");
    dom.textStyle = document.getElementById("text-style");
    dom.textFont = document.getElementById("text-font");
    dom.textBackgroundOpacity = document.getElementById("text-background-opacity");
    dom.resetCanvas = document.getElementById("reset-canvas");
    dom.mapUpload = document.getElementById("map-upload");
    dom.circleUploadTop = document.getElementById("circle-upload-top");
    dom.circleUploadBottom = document.getElementById("circle-upload-bottom");
    dom.logoUpload = document.getElementById("logo-upload");
    dom.backgroundUpload = document.getElementById("background-upload");
    dom.detailUpload = document.getElementById("detail-upload");
    dom.waypointUpload = document.getElementById("waypoint-upload");

    dom.speedToggles = [document.getElementById('speed-toggle-0'), document.getElementById('speed-toggle-1'), document.getElementById('speed-toggle-3')].filter(el => el !== null);
    dom.speedValues = [document.getElementById('speed-value-0'), document.getElementById('speed-value-1'), document.getElementById('speed-value-3')].filter(el => el !== null);
    dom.speedUnits = [document.getElementById('speed-unit-0'), document.getElementById('speed-unit-1')].filter(el => el !== null);

    dom.zoomIn = document.getElementById("zoom-in");
    dom.zoomOut = document.getElementById("zoom-out");
    dom.zoomInTop = document.getElementById("zoom-in-top");
    dom.zoomOutTop = document.getElementById("zoom-out-top");
    dom.zoomInBottom = document.getElementById("zoom-in-bottom");
    dom.zoomOutBottom = document.getElementById("zoom-out-bottom");
    dom.zoomInDetail = document.getElementById("zoom-in-detail");
    dom.zoomOutDetail = document.getElementById("zoom-out-detail");
    dom.zoomInWaypoint = document.getElementById("zoom-in-waypoint");
    dom.zoomOutWaypoint = document.getElementById("zoom-out-waypoint");

    dom.manualOffsetSelect.addEventListener('change', () => { drawCanvas(); updateInGameTimeEmojis(); });

    try { initTimezoneSettings(() => { drawCanvas(); updateInGameTimeEmojis(); }); } catch (e) { console.error('[INIT] timezoneSettings failed:', e); }
    try { initTimeSync(); } catch (e) { console.error('[INIT] timeSync failed:', e); }
    try { initAbout(); } catch (e) { console.error('[INIT] about failed:', e); }
    try { initStylePicker(); } catch (e) { console.error('[INIT] stylePicker failed:', e); }

    let swarmRefresh;
    try { swarmRefresh = initSwarm(); } catch (e) { console.error('[INIT] swarm failed:', e); }
    try { initSwarmPublish(swarmRefresh); } catch (e) { console.error('[INIT] swarmPublish failed:', e); }
    try { initSlots(); } catch (e) { console.error('[INIT] slots failed:', e); }
    try { initAuthorProfile(); } catch (e) { console.error('[INIT] authorProfile failed:', e); }

    async function refreshFooter() {
        const statusEl = document.getElementById('footer-status');
        const peersEl = document.getElementById('footer-peers');
        const p2pDot = document.querySelector('#p2p-indicator .p2p-dot');
        const p2pCount = document.getElementById('p2p-count');
        if (!statusEl) return;
        try {
            const { swarmStatus, getDiscoveryState } = await import('./native/tauri-bridge.js');
            const [status, discovery] = await Promise.all([swarmStatus(), getDiscoveryState()]);
            const mode = status.mode || 'local';
            const nc = discovery.neighborCount || 0;
            statusEl.dataset.mode = mode;
            if (mode === 'online') {
                statusEl.textContent = state.currentLangData.discovery_connected?.replace('{count}', nc) || `${nc} peers`;
                peersEl.textContent = nc + (state.currentLangData.footer_peers_suffix || ' peers');
            } else if (mode === 'searching') {
                statusEl.textContent = state.currentLangData.discovery_searching || 'P2P active — searching for peers...';
                peersEl.textContent = '0' + (state.currentLangData.footer_peers_suffix || ' peers');
            } else {
                statusEl.textContent = state.currentLangData.discovery_offline || 'P2P offline';
                peersEl.textContent = '0' + (state.currentLangData.footer_peers_suffix || ' peers');
            }
            if (p2pDot) p2pDot.dataset.status = mode === 'online' ? 'online' : (mode === 'searching' ? 'searching' : 'offline');
            if (p2pCount) p2pCount.textContent = nc;
        } catch {
            statusEl.textContent = state.currentLangData.discovery_offline || 'P2P offline';
            peersEl.textContent = '';
            if (p2pDot) p2pDot.dataset.status = 'offline';
            if (p2pCount) p2pCount.textContent = '0';
        }
    }
    refreshFooter();
    if (_footerInterval) clearInterval(_footerInterval);
    _footerInterval = setInterval(refreshFooter, 30000);

    initFlyerLoad(() => { drawCanvas(); updateInGameTimeEmojis(); });
    initClipboard();
    initCanvasControls(() => updateInGameTimeEmojis());

    const userNow = DateTime.local();
    dom.customDate.value = userNow.toISODate();
    dom.customTime.value = userNow.toFormat('HH:mm');

    updateLiveClocks();
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(updateLiveClocks, 1000);

    dom.downloadCanvas.addEventListener("click", performDownload);
    initCanvasEventListeners();

    drawCanvas();
    updateInGameTimeEmojis();

    document.fonts.ready.then(() => drawCanvas());
    state.watermarkImage.onload = () => drawCanvas();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
