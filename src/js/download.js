import { dom } from './dom.js';
import * as state from './core/state.js';
import { resolveMeetingDateTime } from './core/time.js';
import { cloneFlyerDocument, injectCtesFlyerDocumentIntoPNG } from './core/png-metadata.js';
import { saveFile, optimizePng } from './native/tauri-bridge.js';
import { drawCanvas } from './canvas.js';
import { showFooterAction } from './core/utils.js';

const { DateTime } = luxon;

function cloneValue(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
}

function normalizeGameId(value) {
    const game = String(value || '').trim().toUpperCase();
    if (game === 'ATS') return 'ats';
    if (game === 'ETS2') return 'ets2';
    return 'other';
}

function normalizeEventType(value) {
    const type = String(value || '').trim();
    const allowed = new Set(['convoy', 'truck_show', 'exploration', 'competition', 'meetup', 'other']);
    return allowed.has(type) ? type : 'convoy';
}

function buildFlyerEvent(meetingDateTime, departureDateTime, arrivalDateTime, zone) {
    const baseDocument = cloneFlyerDocument(state.loadedFlyerDocument) || { specVersion: '1.0', kind: 'flyer', event: {} };
    const event = cloneValue(baseDocument.event) || {};
    const customEventName = dom.customEventName.value || state.currentLangData.canvas_default_event_name || 'Evento Personalizado';
    const customDescription = dom.customEventDescription.value.trim();
    const customServer = dom.customServer.value.trim();
    const startCity = dom.customStartCity?.value?.trim() || dom.customStartPlace?.value?.trim() || '';
    const startLocation = dom.customStartLocation?.value?.trim() || '';
    const destCity = dom.customDestCity?.value?.trim() || dom.customDestination?.value?.trim() || '';
    const destLocation = dom.customDestLocation?.value?.trim() || '';
    const link = dom.customEventLink.value.trim();

    event.title = customEventName;
    if (customDescription) event.description = customDescription;
    else delete event.description;
    if (!event.language) event.language = state.currentLang || 'en';
    event.eventType = normalizeEventType(event.eventType || 'convoy');
    event.game = normalizeGameId(event.game || 'ATS');

    if (!event.network || typeof event.network !== 'object') event.network = {};
    if (customServer) event.network.server = customServer;
    if (!event.network.name && (event.network.server || customServer)) {
        event.network.name = event.network.server || customServer;
    }
    if (!event.network.access) delete event.network.access;

    event.schedule = {
        ...(event.schedule || {}),
        meetingAt: meetingDateTime.toUTC().toISO(),
        startAt: departureDateTime.toUTC().toISO(),
        endAt: arrivalDateTime.toUTC().toISO(),
        timeZone: zone,
    };

    const hasRoute = !!startCity || !!startLocation || !!destCity || !!destLocation || !!event.route;
    if (hasRoute) {
        const route = cloneValue(event.route) || {};
        if (startCity) {
            route.origins = [{
                city: startCity,
                ...(startLocation ? { location: startLocation } : {}),
            }];
        } else if (!route.origins) {
            delete route.origins;
        }
        if (destCity) {
            route.destination = {
                city: destCity,
                ...(destLocation ? { location: destLocation } : {}),
            };
        } else if (!route.destination) {
            delete route.destination;
        }
        event.route = route;
    } else {
        delete event.route;
    }

    if (link) {
        event.links = [{ rel: 'details', url: link }];
    } else if (!event.links) {
        delete event.links;
    }

    baseDocument.specVersion = '1.0';
    baseDocument.kind = 'flyer';
    baseDocument.event = event;
    return baseDocument;
}

export async function performDownload() {
    showFooterAction(state.currentLangData.footer_action_generating || 'Generating PNG...', 0);
    const scale = parseFloat(dom.canvasSize.value) || 1;
    const exportCanvas = document.createElement('canvas');
    drawCanvas(exportCanvas, scale);
    try {
        exportCanvas.toBlob(async (blob) => {
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

                const optimizedBuffer = await optimizePng(arrayBuffer);
                const flyerDocument = buildFlyerEvent(meetingDateTime, departureDateTime, arrivalDateTime, zone);
                const newPngBuffer = injectCtesFlyerDocumentIntoPNG(optimizedBuffer, flyerDocument);

                const dateString = dom.customDate.value || DateTime.local().toISODate();
                await saveFile(new Uint8Array(newPngBuffer), `convoy-map-${dateString}.png`);
                showFooterAction(state.currentLangData.footer_action_saved || 'PNG saved');
            } catch (err) {
                console.error("[DOWNLOAD] Failed:", err);
                showFooterAction(state.currentLangData.footer_action_error || 'Error');
            }
        }, 'image/png');
    } catch (error) {
        console.error("[DOWNLOAD] Failed:", error);
    }
}
