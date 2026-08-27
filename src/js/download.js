import { dom } from './dom.js';
import * as state from './core/state.js';
import { getGameTime, resolveMeetingDateTime } from './core/time.js';
import { injectMetadataIntoPNG } from './core/png-metadata.js';
import { saveFile, optimizePng } from './native/tauri-bridge.js';
import { drawCanvas } from './canvas.js';
import { showFooterAction } from './core/utils.js';

const { DateTime } = luxon;

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
