import { dom } from './dom.js';
import * as state from './core/state.js';
import { drawCanvas } from './canvas.js';
import { readMetadataFromPNG } from './core/png-metadata.js';
import { showCopyMessage, showFooterAction } from './core/utils.js';

const { DateTime } = luxon;

export function initFlyerLoad(onLoad) {
    dom.loadFlyerInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showFooterAction(state.currentLangData.footer_action_loading || 'Loading flyer...');
        try {
            const buffer = await file.arrayBuffer();
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
