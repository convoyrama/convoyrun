import { dom } from './dom.js';
import * as state from './core/state.js';
import { drawCanvas } from './canvas.js';
import { readCtesFlyerDocumentFromPNG } from './core/png-metadata.js';
import { showCopyMessage, showFooterAction } from './core/utils.js';

const { DateTime } = luxon;

function applyFlyerDocument(document) {
    const event = document.event || {};
    dom.customEventName.value = event.title || "";
    dom.customEventLink.value = Array.isArray(event.links) ? (event.links.find(link => link.rel === 'details')?.url || "") : "";
    dom.customServer.value = event.network?.server || "";

    const route = event.route || {};
    const origin = Array.isArray(route.origins) ? route.origins[0] : null;
    const destination = route.destination || {};
    const startCity = origin?.city || "";
    const startLocation = origin?.location || "";
    const destCity = destination.city || "";
    const destLocation = destination.location || "";

    if (dom.customStartCity) dom.customStartCity.value = startCity;
    else if (dom.customStartPlace) dom.customStartPlace.value = startCity;
    if (dom.customStartLocation) dom.customStartLocation.value = startLocation;
    if (dom.customDestCity) dom.customDestCity.value = destCity;
    else if (dom.customDestination) dom.customDestination.value = destCity;
    if (dom.customDestLocation) dom.customDestLocation.value = destLocation;

    dom.customEventDescription.value = event.description || "";

    const schedule = event.schedule || {};
    const meetingAt = schedule.meetingAt;
    const timeZone = schedule.timeZone;
    const startAt = schedule.startAt;

    if (meetingAt && timeZone) {
        const meeting = DateTime.fromISO(meetingAt, { zone: timeZone });
        if (meeting.isValid) {
            dom.customDate.value = meeting.toISODate();
            dom.customTime.value = meeting.toFormat('HH:mm');
        }
    }
    if (meetingAt && startAt) {
        const meeting = DateTime.fromISO(meetingAt, { zone: timeZone || 'UTC' });
        const start = DateTime.fromISO(startAt, { zone: timeZone || 'UTC' });
        if (meeting.isValid && start.isValid) {
            const diffMinutes = Math.round((start.toMillis() - meeting.toMillis()) / 60000);
            if ([10, 15, 30, 45].includes(diffMinutes)) dom.departureTimeOffset.value = String(diffMinutes);
        }
    }
    state.setLoadedFlyerDocument(document);
}

export function initFlyerLoad(onLoad) {
    dom.loadFlyerInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showFooterAction(state.currentLangData.footer_action_loading || 'Loading flyer...');
        try {
            const buffer = await file.arrayBuffer();
            const flyerDocument = readCtesFlyerDocumentFromPNG(buffer);
            if (!flyerDocument) {
                state.clearLoadedFlyerDocument();
                showCopyMessage(state.currentLangData.load_flyer_not_found || "Esta imagen no tiene datos CTES de ConvoyRun.");
                return;
            }
            applyFlyerDocument(flyerDocument);
            onLoad();
            showCopyMessage(state.currentLangData.load_flyer_success || "Flyer cargado correctamente.");
        } catch (err) {
            console.error("[LOAD-FLYER] Failed:", err);
            showCopyMessage(state.currentLangData.load_flyer_error || "No se pudo leer el archivo.");
        } finally {
            dom.loadFlyerInput.value = "";
        }
    });
}
