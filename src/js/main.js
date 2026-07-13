import { dom } from './dom.js';
import * as state from './core/state.js';
import { updateLiveClocks, getGameTime, getDetailedDayNightIcon, formatDateForDisplay, resolveMeetingDateTime } from './core/time.js';
import { initI18n } from './i18n.js';
import { drawCanvas, initCanvasEventListeners } from './canvas.js';
import { showCopyMessage, getZoneLabel } from './core/utils.js';
import { injectMetadataIntoPNG, readMetadataFromPNG } from './core/png-metadata.js';
import { saveFile, copyToClipboard, optimizePng } from './native/tauri-bridge.js';
import { initTimezoneSettings, refreshZoneSettingsUI } from './timezone-picker.js';
import { initTimeSync } from './time-sync.js';
import { initAbout } from './about.js';
import { initStylePicker } from './style-picker.js';

const { DateTime } = luxon;

function updateInGameTimeEmojis() {
    if (!dom.ingameEmojiDisplay) return;
    const customDateValue = dom.customDate.value;
    const customTimeValue = dom.customTime.value;

    if (!customDateValue || !customTimeValue) {
        dom.ingameEmojiDisplay.innerHTML = '';
        return;
    }

    const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, dom.manualOffsetSelect.value);

    if (!meetingDateTime.isValid) {
        dom.ingameEmojiDisplay.innerHTML = '';
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

    dom.ingameEmojiDisplay.innerHTML = `${meetingEmoji} ${departureEmoji} ${arrivalEmoji}`;
}

async function performDownload() {
    const scale = parseFloat(dom.canvasSize.value) || 1;
    const exportCanvas = document.createElement('canvas');
    drawCanvas(exportCanvas, scale);
    try {
        exportCanvas.toBlob(async (blob) => {
            const arrayBuffer = await blob.arrayBuffer();

            const customDateValue = dom.customDate.value;
            const customTimeValue = dom.customTime.value;
            const manualOffset = dom.manualOffsetSelect.value;
            const meetingDateTime = resolveMeetingDateTime(customDateValue, customTimeValue, manualOffset);
            if (!meetingDateTime.isValid) return;

            let zone = manualOffset === 'auto' ? DateTime.local().zoneName : 'UTC';

            const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
            const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });
            const arrivalDateTime = departureDateTime.plus({ minutes: 45 });

            const meetingGameTime = getGameTime(meetingDateTime.toUTC());
            const arrivalGameTime = getGameTime(arrivalDateTime.toUTC());

            const metadata = {
                eventName: dom.customEventName.value || state.currentLangData.canvas_default_event_name || "Evento Personalizado",
                eventLink: dom.customEventLink.value || "https://convoyrama.github.io/event.html",
                startPlace: dom.customStartPlace.value || "Sin especificar",
                destination: dom.customDestination.value || "Sin especificar",
                server: dom.customServer.value || "Sin especificar",
                description: dom.customEventDescription.value || "Sin descripción",
                meetingTimestamp: meetingDateTime.toUnixInteger(),
                departureTimestamp: departureDateTime.toUnixInteger(),
                arrivalTimestamp: arrivalDateTime.toUnixInteger(),
                meetingGameTime: { hours: meetingGameTime.hours, minutes: meetingGameTime.minutes },
                arrivalGameTime: { hours: arrivalGameTime.hours, minutes: arrivalGameTime.minutes },
                ianaTimeZone: zone,
                utcOffsetMinutes: meetingDateTime.offset,
                generatedAt: DateTime.local().toISO(),
            };

            const optimizedBuffer = await optimizePng(arrayBuffer);

            const jsonMetadata = JSON.stringify(metadata);
            const newPngBuffer = injectMetadataIntoPNG(optimizedBuffer, "convoyrama-event-data", jsonMetadata);

            const dateString = dom.customDate.value || DateTime.local().toISODate();
            await saveFile(new Uint8Array(newPngBuffer), `convoy-map-${dateString}.png`);
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

    drawCanvas();
    updateInGameTimeEmojis();
});

async function init() {
    initI18n();

    dom.customDate = document.getElementById("custom-date");
    dom.customTime = document.getElementById("custom-time");
    dom.customEventName = document.getElementById("custom-event-name");
    dom.customEventLink = document.getElementById("custom-event-link");
    dom.customStartPlace = document.getElementById("custom-start-place");
    dom.customDestination = document.getElementById("custom-destination");
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

    initTimezoneSettings(() => { drawCanvas(); updateInGameTimeEmojis(); });
    initTimeSync();
    initAbout();
    initStylePicker();

    dom.loadFlyerInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            const raw = readMetadataFromPNG(buffer, "convoyrama-event-data");
            if (!raw) {
                showCopyMessage(state.currentLangData.load_flyer_not_found || "Esta imagen no tiene datos de ConvoyRun.");
                return;
            }
            const metadata = JSON.parse(raw);

            dom.customEventName.value = metadata.eventName || "";
            dom.customEventLink.value = metadata.eventLink || "";
            dom.customStartPlace.value = metadata.startPlace || "";
            dom.customDestination.value = metadata.destination || "";
            dom.customServer.value = metadata.server || "";
            dom.customEventDescription.value = metadata.description || "";

            if (metadata.meetingTimestamp && metadata.ianaTimeZone) {
                const meeting = DateTime.fromSeconds(metadata.meetingTimestamp, { zone: metadata.ianaTimeZone });
                if (meeting.isValid) {
                    dom.customDate.value = meeting.toISODate();
                    dom.customTime.value = meeting.toFormat('HH:mm');
                }
            }
            if (metadata.meetingTimestamp && metadata.departureTimestamp) {
                const diffMinutes = Math.round((metadata.departureTimestamp - metadata.meetingTimestamp) / 60);
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
    setInterval(updateLiveClocks, 1000);

    dom.copyCustomInfo.onclick = () => {
        const customDateValue = dom.customDate.value, customTimeValue = dom.customTime.value;
        const nameKey = state.currentLangData.canvas_default_event_name || "Evento Personalizado";
        const customEventNameValue = dom.customEventName.value || nameKey;
        const customEventLinkValue = dom.customEventLink.value || "https://convoyrama.github.io/event.html", customEventDescriptionValue = dom.customEventDescription.value || "Sin descripción";
        const customStartPlaceValue = dom.customStartPlace.value || "Sin especificar", customDestinationValue = dom.customDestination.value || "Sin especificar", customServerValue = dom.customServer.value || "Sin especificar";

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
        const customStartPlaceValue = dom.customStartPlace.value || "Sin especificar";
        const customDestinationValue = dom.customDestination.value || "Sin especificar";
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
    // drawCanvas ahora toma (targetCanvas, scale) — pasarla directo como
    // callback le mandaría el Event como targetCanvas y rompe todo en
    // silencio. Siempre envuelta en función así se llama sin argumentos.
    dom.textSize.addEventListener("change", () => drawCanvas());
    dom.textStyle.addEventListener("change", () => drawCanvas());
    dom.textFont.addEventListener("change", () => drawCanvas());
    dom.textBackgroundOpacity.addEventListener("change", () => drawCanvas());
    dom.downloadCanvas.addEventListener("click", performDownload);
    dom.customEventName.addEventListener("input", () => drawCanvas());
    dom.customStartPlace.addEventListener("input", () => drawCanvas());
    dom.customDestination.addEventListener("input", () => drawCanvas());
    dom.customDate.addEventListener("change", (e) => {
        const d = DateTime.fromISO(e.target.value);
        if (d.isValid && state.currentLangData) {
            const labelKey = state.currentLangData.label_selected_date || 'Fecha seleccionada';
            dom.customDateDisplay.textContent = `${labelKey}: ${formatDateForDisplay(d)}`;
        }
        drawCanvas();
    });

    // El picker nativo de WebKitGTK no cierra con Escape solo — hay que
    // sacarle el foco al input a mano para que se cierre.
    dom.customDate.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customDate.blur(); });
    dom.customTime.addEventListener("keydown", (e) => { if (e.key === "Escape") dom.customTime.blur(); });

    dom.customTime.addEventListener("input", () => { drawCanvas(); updateInGameTimeEmojis(); });
    dom.departureTimeOffset.addEventListener("change", () => { drawCanvas(); updateInGameTimeEmojis(); });

    dom.resetCanvas.addEventListener("click", () => {
        state.setMapImage(null); state.setCircleImageTop(null); state.setCircleImageBottom(null);
        state.setLogoImage(null); state.setBackgroundImage(null); state.setDetailImage(null); state.setCircleImageWaypoint(null);
        dom.mapUpload.value = ""; dom.circleUploadTop.value = ""; dom.circleUploadBottom.value = "";
        dom.logoUpload.value = ""; dom.backgroundUpload.value = ""; dom.detailUpload.value = ""; dom.waypointUpload.value = "";
        drawCanvas();
    });

    dom.speedToggles.forEach((toggle, index) => toggle.addEventListener('change', (e) => { state.speedIndicators[index].visible = e.target.checked; drawCanvas(); }));
    dom.speedValues.forEach((input, index) => input.addEventListener('input', (e) => { state.speedIndicators[index].value = e.target.value; drawCanvas(); }));
    dom.speedUnits.forEach((select, index) => select.addEventListener('change', (e) => { state.speedIndicators[index].unit = e.target.value; drawCanvas(); }));

    drawCanvas();
    updateInGameTimeEmojis();

    // Canvas 2D no re-dibuja solo cuando un @font-face termina de cargar (a diferencia
    // del texto normal del DOM) -- si el primer render cae antes de que la fuente esté
    // lista, queda con la tipografía de fallback del sistema para siempre.
    document.fonts.ready.then(() => drawCanvas());
}

document.addEventListener('DOMContentLoaded', init);
