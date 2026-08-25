import { dom } from './dom.js';
import * as state from './core/state.js';
import { updateLiveClocks, getGameTime, getDetailedDayNightIcon, formatDateForDisplay, resolveMeetingDateTime } from './core/time.js';
import { initI18n } from './i18n.js';
import { drawCanvas, initCanvasEventListeners, revokeAllObjectUrls } from './canvas.js';
import { showCopyMessage, getZoneLabel } from './core/utils.js';
import { injectMetadataIntoPNG, readMetadataFromPNG } from './core/png-metadata.js';
import { saveFile, copyToClipboard, optimizePng } from './native/tauri-bridge.js';
import { initTimezoneSettings, refreshZoneSettingsUI } from './timezone-picker.js';
import { initTimeSync } from './time-sync.js';
import { initAbout } from './about.js';
import { initStylePicker } from './style-picker.js';
import { initSwarm } from './swarm.js';
import { initSwarmPublish } from './swarm-publish.js';
import { initSlots, recalcTimeline } from './slots.js';
import { initAuthorProfile } from './author-profile.js';

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

async function performDownload() {
    const scale = parseFloat(dom.canvasSize.value) || 1;
    const exportCanvas = document.createElement('canvas');
    drawCanvas(exportCanvas, scale);
    try {
        exportCanvas.toBlob(async (blob) => {
            // Release canvas memory after blob is created
            exportCanvas.width = 0;
            exportCanvas.height = 0;
            try {
            const arrayBuffer = await blob.arrayBuffer();

            const customDateValue = dom.customDate.value;
            const customTimeValue = dom.customTime.value;
            const manualOffset = dom.manualOffsetSelect.value;
            const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, manualOffset);
            if (!meetingDateTime.isValid) return;

            let zone = manualOffset === 'auto' ? DateTime.local().zoneName : 'UTC';

            const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
            const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });
            const arrivalDateTime = departureDateTime.plus({ minutes: 50 });

            const meetingGameTime = getGameTime(meetingDateTime.toUTC());
            const arrivalGameTime = getGameTime(arrivalDateTime.toUTC());

            const metadata = {
                schema: 'convoyrun-event-v1',
                name: dom.customEventName.value || state.currentLangData.canvas_default_event_name || "Evento Personalizado",
                type: 'convoy',
                game: 'ATS',
                mode: 'simulation',
                link: dom.customEventLink.value || "",
                server: dom.customServer.value || "",
                route: {
                    startCity: dom.customStartCity?.value || dom.customStartPlace?.value || "",
                    startLocation: dom.customStartLocation?.value || "",
                    destCity: dom.customDestCity?.value || dom.customDestination?.value || "",
                    destLocation: dom.customDestLocation?.value || "",
                },
                description: dom.customEventDescription.value || "",
                languages: [],
                schedule: {
                    meetingTimestamp: meetingDateTime.toUnixInteger(),
                    departureTimestamp: departureDateTime.toUnixInteger(),
                    arrivalTimestamp: arrivalDateTime.toUnixInteger(),
                    ianaTimeZone: zone,
                },
                gameTime: {
                    meeting: { hours: meetingGameTime.hours, minutes: meetingGameTime.minutes },
                    arrival: { hours: arrivalGameTime.hours, minutes: arrivalGameTime.minutes },
                },
                generatedAt: DateTime.local().toISO(),
                generator: 'ConvoyRun',
            };

            const optimizedBuffer = await optimizePng(arrayBuffer);

            const jsonMetadata = JSON.stringify(metadata);
            const newPngBuffer = injectMetadataIntoPNG(optimizedBuffer, "convoyrun-event-v1", jsonMetadata);

            const dateString = dom.customDate.value || DateTime.local().toISODate();
            await saveFile(new Uint8Array(newPngBuffer), `convoy-map-${dateString}.png`);
            } catch (err) {
                console.error("[DOWNLOAD] Failed:", err);
            }
        }, 'image/png');
    } catch (error) {
        console.error("[DOWNLOAD] Failed:", error);
    }
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

    // Actualizar texto del botón de orientación
    if (dom.orientationToggle) {
        const v = state.getIsVertical();
        dom.orientationToggle.textContent = v
            ? (translations.orientation_vertical || 'Vertical')
            : (translations.orientation_landscape || 'Horizontal');
    }

    drawCanvas();
    updateInGameTimeEmojis();
});

// Navegación por pestañas (SWARM / FLYER / ABOUT). Los paneles se muestran por
// data-tab del botón e id `panel-<tab>` de la sección.
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

async function init() {
    initI18n();

    initTabs();

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

    // Footer status refresh + header P2P indicator
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

    function setFooterAction(text) {
        const el = document.getElementById('footer-action');
        if (el) el.textContent = text || '';
    }

    dom.loadFlyerInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            // Intentar leer con el nuevo schema primero, luego el viejo para compatibilidad
            let raw = readMetadataFromPNG(buffer, "convoyrun-event-v1");
            if (!raw) raw = readMetadataFromPNG(buffer, "convoyrama-event-data");
            if (!raw) {
                showCopyMessage(state.currentLangData.load_flyer_not_found || "Esta imagen no tiene datos de ConvoyRun.");
                return;
            }
            const metadata = JSON.parse(raw);

            dom.customEventName.value = metadata.name || metadata.eventName || "";
            dom.customEventLink.value = metadata.link || metadata.eventLink || "";
            dom.customServer.value = metadata.server || "";

            // Soporte para schema viejo (startPlace/destination) y nuevo (route)
            const route = metadata.route || {};
            const startCity = route.startCity || metadata.startPlace || "";
            const startLocation = route.startLocation || "";
            const destCity = route.destCity || metadata.destination || "";
            const destLocation = route.destLocation || "";

            if (dom.customStartCity) dom.customStartCity.value = startCity;
            else if (dom.customStartPlace) dom.customStartPlace.value = startCity;
            if (dom.customStartLocation) dom.customStartLocation.value = startLocation;
            if (dom.customDestCity) dom.customDestCity.value = destCity;
            else if (dom.customDestination) dom.customDestination.value = destCity;
            if (dom.customDestLocation) dom.customDestLocation.value = destLocation;

            dom.customEventDescription.value = metadata.description || "";

            // Soporte para schema viejo (campos sueltos) y nuevo (schedule anidado)
            const schedule = metadata.schedule || {};
            const meetingTs = schedule.meetingTimestamp || metadata.meetingTimestamp;
            const ianaTz = schedule.ianaTimeZone || metadata.ianaTimeZone;
            const departureTs = schedule.departureTimestamp || metadata.departureTimestamp;

            if (meetingTs && ianaTz) {
                const meeting = DateTime.fromSeconds(meetingTs, { zone: ianaTz });
                if (meeting.isValid) {
                    dom.customDate.value = meeting.toISODate();
                    dom.customTime.value = meeting.toFormat('HH:mm');
                }
            }
            if (meetingTs && departureTs) {
                const diffMinutes = Math.round((departureTs - meetingTs) / 60);
                if ([10, 15, 30, 45].includes(diffMinutes)) dom.departureTimeOffset.value = String(diffMinutes);
            }

            drawCanvas();
            updateInGameTimeEmojis();
            showCopyMessage(state.currentLangData.load_flyer_success || "Flyer cargado correctamente.");
        } catch (err) {
            console.error("[LOAD-FLYER] Failed:", err);
            showCopyMessage(state.currentLangData.load_flyer_error || "No se pudo leer el archivo.");
        } finally {
            dom.loadFlyerInput.value = "";
        }
    });

    const userNow = DateTime.local();
    dom.customDate.value = userNow.toISODate();
    dom.customTime.value = userNow.toFormat('HH:mm');

    updateLiveClocks();
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(updateLiveClocks, 1000);

    dom.copyCustomInfo.onclick = () => {
        const customDateValue = dom.customDate.value, customTimeValue = dom.customTime.value;
        const nameKey = state.currentLangData.canvas_default_event_name || "Evento Personalizado";
        const customEventNameValue = dom.customEventName.value || nameKey;
        const customEventLinkValue = dom.customEventLink.value || "https://convoyrama.github.io";
        const customEventDescriptionValue = dom.customEventDescription.value || "Sin descripción";
        const customStartCityValue = dom.customStartCity?.value || dom.customStartPlace?.value || "";
        const customStartLocationValue = dom.customStartLocation?.value || "";
        const customDestCityValue = dom.customDestCity?.value || dom.customDestination?.value || "";
        const customDestLocationValue = dom.customDestLocation?.value || "";
        const customStartPlaceValue = customStartCityValue ? (customStartLocationValue ? `${customStartCityValue} — ${customStartLocationValue}` : customStartCityValue) : "Sin especificar";
        const customDestinationValue = customDestCityValue ? (customDestLocationValue ? `${customDestCityValue} — ${customDestLocationValue}` : customDestCityValue) : "Sin especificar";
        const customServerValue = dom.customServer.value || "Sin especificar";

        const errorKey = state.currentLangData.error_no_date || "Por favor, selecciona una fecha y hora.";
        if (!customDateValue || !customTimeValue) { showCopyMessage(errorKey); return; }

        const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, dom.manualOffsetSelect.value);

        if (!meetingDateTime.isValid) {
            const invalidKey = state.currentLangData.error_invalid_date || "Fecha u hora inválida.";
            showCopyMessage(invalidKey);
            return;
        }

        const meetingTimestamp = meetingDateTime.toUnixInteger();
        const meetingGameTime = getGameTime(meetingDateTime.toUTC());
        const meetingEmoji = getDetailedDayNightIcon(meetingGameTime.hours);

        const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
        const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });
        const departureTimestamp = departureDateTime.toUnixInteger();
        const departureGameTime = getGameTime(departureDateTime.toUTC());
        const departureEmoji = getDetailedDayNightIcon(departureGameTime.hours);

        const arrivalDateTime = departureDateTime.plus({ minutes: 50 });
        const arrivalTimestamp = arrivalDateTime.toUnixInteger();
        const arrivalGameTime = getGameTime(arrivalDateTime.toUTC());
        const arrivalEmoji = getDetailedDayNightIcon(arrivalGameTime.hours);

        const itKey = state.currentLangData.ingame_time_title || 'Hora ingame';
        const mKey = state.currentLangData.meeting_label || 'Reunión';
        const sKey = state.currentLangData.departure_label || 'Salida';
        const aKey = state.currentLangData.arrival_label || 'Llegada aprox';
        const dtKey = state.currentLangData.discord_arrival_time || 'Llegada Aprox.:';

        const ingameTimeLine = `**${itKey}:** ${mKey}: ${meetingEmoji} ${sKey}: ${departureEmoji} ${aKey}: ${arrivalEmoji}`;

        let convoyInfo = `[**${customEventNameValue}**](${customEventLinkValue})\nServidor: ${customServerValue}\nPartida: ${customStartPlaceValue}\nDestino: ${customDestinationValue}\n\n**Reunión:** <t:${meetingTimestamp}:F> (<t:${meetingTimestamp}:R>)\n**Salida:** <t:${departureTimestamp}:t> (<t:${departureTimestamp}:R>)\n**${dtKey}** <t:${arrivalTimestamp}:t> (<t:${arrivalTimestamp}:R>)\n${ingameTimeLine}\n\nDescripción: ${customEventDescriptionValue}`;
        copyToClipboard(convoyInfo).then(() => showCopyMessage()).catch(err => console.error("[CLIPBOARD] Failed:", err));
    };

    dom.copyTmpBtn.onclick = () => {
        const customDateValue = dom.customDate.value, customTimeValue = dom.customTime.value;
        const nameKey = state.currentLangData.canvas_default_event_name || "Evento Personalizado";
        const customEventNameValue = dom.customEventName.value || nameKey;
        const customEventDescriptionValue = dom.customEventDescription.value || "Sin descripción";
        const customStartCityValue = dom.customStartCity?.value || dom.customStartPlace?.value || "";
        const customStartLocationValue = dom.customStartLocation?.value || "";
        const customDestCityValue = dom.customDestCity?.value || dom.customDestination?.value || "";
        const customDestLocationValue = dom.customDestLocation?.value || "";
        const customStartPlaceValue = customStartCityValue ? (customStartLocationValue ? `${customStartCityValue} — ${customStartLocationValue}` : customStartCityValue) : "Sin especificar";
        const customDestinationValue = customDestCityValue ? (customDestLocationValue ? `${customDestCityValue} — ${customDestLocationValue}` : customDestCityValue) : "Sin especificar";
        const customServerValue = dom.customServer.value || "Sin especificar";

        const errorKey = state.currentLangData.error_no_date || "Por favor, selecciona una fecha y hora.";
        if (!customDateValue || !customTimeValue) { showCopyMessage(errorKey); return; }

        const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, dom.manualOffsetSelect.value);

        if (!meetingDateTime.isValid) {
            const invalidKey = state.currentLangData.error_invalid_date || "Fecha u hora inválida.";
            showCopyMessage(invalidKey);
            return;
        }

        const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
        const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });

        const meetingGameTime = getGameTime(meetingDateTime.toUTC());
        const meetingEmoji = getDetailedDayNightIcon(meetingGameTime.hours);
        const departureGameTime = getGameTime(departureDateTime.toUTC());
        const departureEmoji = getDetailedDayNightIcon(departureGameTime.hours);
        const arrivalGameTime = getGameTime(meetingDateTime.plus({ minutes: departureOffsetMinutes + 50 }).toUTC());
        const arrivalEmoji = getDetailedDayNightIcon(arrivalGameTime.hours);

        const includeImages = dom.tmpImagesToggle.checked;
        const activeZones = state.getActiveZones();
        let tmpInfo = `# ${customEventNameValue}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/green.png)\n\n`;
        tmpInfo += `## ${state.currentLangData.tmp_description_title || 'DESCRIPCIÓN'}\n> ${customEventDescriptionValue}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/purple.png)\n\n`;
        tmpInfo += `## ${state.currentLangData.tmp_event_info_title || 'INFORMACION DEL EVENTO'}\n`;
        tmpInfo += `* 🗓️ ${state.currentLangData.tmp_date_label || 'Fecha (UTC)'}: ${meetingDateTime.toUTC().toFormat('dd/MM/yyyy')}\n`;
        tmpInfo += `* ⏰ ${state.currentLangData.tmp_meeting_time_label || 'Reunión (UTC)'}: ${meetingDateTime.toUTC().toFormat('HH:mm')}\n`;
        tmpInfo += `* 🚚 ${state.currentLangData.tmp_departure_time_label || 'Salida (UTC)'}: ${departureDateTime.toUTC().toFormat('HH:mm')}\n`;
        tmpInfo += `* 🖥️ ${state.currentLangData.tmp_server_label || 'Servidor'}: ${customServerValue}\n`;
        tmpInfo += `* ➡️ ${state.currentLangData.tmp_start_place_label || 'Ciudad de Inicio'}: ${customStartPlaceValue}\n`;
        tmpInfo += `* ⬅️ ${state.currentLangData.tmp_destination_label || 'Ciudad de Destino'}: ${customDestinationValue}\n\n`;

        if (activeZones.length > 0) {
            const datesByDay = new Map();
            activeZones.forEach(tz => {
                const localTimeForTz = meetingDateTime.setZone(tz.iana_tz);
                const dayString = localTimeForTz.toFormat('dd MMM');
                if (!datesByDay.has(dayString)) datesByDay.set(dayString, []);
                const tzLabel = getZoneLabel(tz, state.currentLangData);
                const timeString = `${localTimeForTz.toFormat('HH:mm')} / ${localTimeForTz.plus({ minutes: departureOffsetMinutes }).toFormat('HH:mm')}`;
                datesByDay.get(dayString).push({ tzLabel, timeString });
            });

            Array.from(datesByDay.keys()).forEach(dayString => {
                tmpInfo += `### ${dayString}\n`;
                datesByDay.get(dayString).forEach(entry => tmpInfo += `* ${entry.tzLabel}: ${entry.timeString}\n`);
                tmpInfo += '\n';
            });
        }

        const itKey = state.currentLangData.ingame_time_title || 'Hora ingame';
        const mKey = state.currentLangData.meeting_label || 'Reunión';
        const sKey = state.currentLangData.departure_label || 'Salida';
        const aKey = state.currentLangData.arrival_label || 'Llegada aprox';
        const rKey = state.currentLangData.tmp_rules_reminder || 'Recuerden seguir las normas de TruckersMP';

        tmpInfo += `* ${itKey}: ${mKey}: ${meetingEmoji} ${sKey}: ${departureEmoji} ${aKey}: ${arrivalEmoji}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/orange.png)\n\n`;
        tmpInfo += `[${rKey}](https://truckersmp.com/rules)`;
        copyToClipboard(tmpInfo).then(() => showCopyMessage()).catch(err => console.error("[CLIPBOARD] Failed:", err));
    };

    initCanvasEventListeners();
    dom.waypointToggle.addEventListener('change', (e) => { state.setIsWaypointVisible(e.target.checked); drawCanvas(); });
    dom.departureToggle.addEventListener('change', (e) => { state.setIsDepartureVisible(e.target.checked); drawCanvas(); });
    dom.destinationToggle.addEventListener('change', (e) => { state.setIsDestinationVisible(e.target.checked); drawCanvas(); });

    // Toggle orientación horizontal/vertical
    function updateOrientationUI() {
        const v = state.getIsVertical();
        dom.canvasContainer.classList.toggle('vertical', v);
        dom.orientationToggle.textContent = v
            ? (state.currentLangData.orientation_vertical || 'Vertical')
            : (state.currentLangData.orientation_landscape || 'Horizontal');
    }
    updateOrientationUI();
    dom.orientationToggle.addEventListener('click', () => {
        state.setIsVertical(!state.getIsVertical());
        updateOrientationUI();
        drawCanvas();
    });
    // Envuelta en función: pasar drawCanvas directo mandaría el Event como targetCanvas.
    dom.textSize.addEventListener("change", () => drawCanvas());
    dom.textStyle.addEventListener("change", () => drawCanvas());
    dom.textFont.addEventListener("change", () => drawCanvas());
    dom.textBackgroundOpacity.addEventListener("input", () => {
        const opacityLabel = document.getElementById("opacity-value");
        if (opacityLabel) opacityLabel.textContent = dom.textBackgroundOpacity.value + "%";
        drawCanvas();
    });
    dom.downloadCanvas.addEventListener("click", performDownload);
    dom.customEventName.addEventListener("input", () => drawCanvas());
    dom.customStartCity.addEventListener("input", () => drawCanvas());
    dom.customStartLocation.addEventListener("input", () => drawCanvas());
    dom.customDestCity.addEventListener("input", () => drawCanvas());
    dom.customDestLocation.addEventListener("input", () => drawCanvas());
    dom.customDate.addEventListener("change", (e) => {
        const d = DateTime.fromISO(e.target.value);
        if (d.isValid && state.currentLangData) {
            const labelKey = state.currentLangData.label_selected_date || 'Fecha seleccionada';
            dom.customDateDisplay.textContent = `${labelKey}: ${formatDateForDisplay(d)}`;
        }
        drawCanvas();
    });

    // WebKitGTK no cierra el picker con Escape solo, hace falta el blur.
    dom.customDate.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customDate.blur(); });
    dom.customTime.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customTime.blur(); });

    dom.customTime.addEventListener("input", () => { drawCanvas(); updateInGameTimeEmojis(); });
    dom.departureTimeOffset.addEventListener("change", () => { drawCanvas(); updateInGameTimeEmojis(); });

    dom.resetCanvas.addEventListener("click", () => {
        revokeAllObjectUrls();
        state.setMapImage(null); state.setCircleImageTop(null); state.setCircleImageBottom(null);
        state.setLogoImage(null); state.setBackgroundImage(null); state.setDetailImage(null); state.setCircleImageWaypoint(null);
        // Reset positions and scales
        state.imageX = 0; state.imageY = 0; state.imageScale = 1;
        state.circleImageX = 20; state.circleImageY = 20; state.circleImageScale = 1;
        state.circleImageXBottom = 20; state.circleImageYBottom = 20; state.circleImageScaleBottom = 1;
        state.circleImageXWaypoint = 20; state.circleImageYWaypoint = 20; state.circleImageScaleWaypoint = 1;
        state.detailImageX = 20; state.detailImageY = 20; state.detailImageScale = 1;
        dom.mapUpload.value = ""; dom.circleUploadTop.value = ""; dom.circleUploadBottom.value = "";
        dom.logoUpload.value = ""; dom.backgroundUpload.value = ""; dom.detailUpload.value = ""; dom.waypointUpload.value = "";
        drawCanvas();
    });

    dom.speedToggles.forEach((toggle) => toggle.addEventListener('change', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].visible = e.target.checked; drawCanvas(); } }));
    dom.speedValues.forEach((input) => input.addEventListener('input', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].value = e.target.value; drawCanvas(); } }));
    dom.speedUnits.forEach((select) => select.addEventListener('change', (e) => { const idx = parseInt(e.target.dataset.speedIndex, 10); if (!isNaN(idx)) { state.speedIndicators[idx].unit = e.target.value; drawCanvas(); } }));

    drawCanvas();
    updateInGameTimeEmojis();

    // Canvas 2D no re-dibuja solo cuando carga un @font-face.
    document.fonts.ready.then(() => drawCanvas());

    // Redraw cuando el watermark termina de cargar (si tardó en cargar)
    state.watermarkImage.onload = () => drawCanvas();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
