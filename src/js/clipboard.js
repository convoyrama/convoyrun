import { dom } from './dom.js';
import * as state from './core/state.js';
import { getGameTime, getDetailedDayNightIcon, resolveMeetingDateTime } from './core/time.js';
import { showCopyMessage, getZoneLabel, showFooterAction } from './core/utils.js';
import { copyToClipboard } from './native/tauri-bridge.js';

const { DateTime } = luxon;

function getCommonValues() {
    const customDateValue = dom.customDate.value;
    const customTimeValue = dom.customTime.value;
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

    return {
        customDateValue, customTimeValue, customEventNameValue,
        customEventDescriptionValue, customStartPlaceValue,
        customDestinationValue, customServerValue,
        customEventLinkValue: dom.customEventLink.value || "https://convoyrama.github.io",
    };
}

function validateDate(values) {
    const errorKey = state.currentLangData.error_no_date || "Por favor, selecciona una fecha y hora.";
    if (!values.customDateValue || !values.customTimeValue) { showCopyMessage(errorKey); return null; }

    const meetingDateTime = resolveMeetingDateTime(values.customDateValue, values.customTimeValue, dom.manualOffsetSelect.value);
    if (!meetingDateTime.isValid) {
        const invalidKey = state.currentLangData.error_invalid_date || "Fecha u hora inválida.";
        showCopyMessage(invalidKey);
        return null;
    }
    return meetingDateTime;
}

function computeGameEmojis(meetingDateTime) {
    const departureOffsetMinutes = parseInt(dom.departureTimeOffset.value, 10);
    const departureDateTime = meetingDateTime.plus({ minutes: departureOffsetMinutes });
    const arrivalDateTime = departureDateTime.plus({ minutes: 50 });

    const meetingGameTime = getGameTime(meetingDateTime.toUTC());
    const meetingEmoji = getDetailedDayNightIcon(meetingGameTime.hours);
    const departureGameTime = getGameTime(departureDateTime.toUTC());
    const departureEmoji = getDetailedDayNightIcon(departureGameTime.hours);
    const arrivalGameTime = getGameTime(arrivalDateTime.toUTC());
    const arrivalEmoji = getDetailedDayNightIcon(arrivalGameTime.hours);

    return { meetingEmoji, departureEmoji, arrivalEmoji, departureDateTime, arrivalDateTime, departureOffsetMinutes };
}

export function initClipboard() {
    dom.copyCustomInfo.onclick = () => {
        const values = getCommonValues();
        const meetingDateTime = validateDate(values);
        if (!meetingDateTime) return;

        const meetingTimestamp = meetingDateTime.toUnixInteger();
        const { meetingEmoji, departureEmoji, arrivalEmoji, departureDateTime, arrivalDateTime } = computeGameEmojis(meetingDateTime);
        const departureTimestamp = departureDateTime.toUnixInteger();
        const arrivalTimestamp = arrivalDateTime.toUnixInteger();

        const itKey = state.currentLangData.ingame_time_title || 'Hora ingame';
        const mKey = state.currentLangData.meeting_label || 'Reunión';
        const sKey = state.currentLangData.departure_label || 'Salida';
        const aKey = state.currentLangData.arrival_label || 'Llegada aprox';
        const dtKey = state.currentLangData.discord_arrival_time || 'Llegada Aprox.:';

        const ingameTimeLine = `**${itKey}:** ${mKey}: ${meetingEmoji} ${sKey}: ${departureEmoji} ${aKey}: ${arrivalEmoji}`;

        const convoyInfo = `[**${values.customEventNameValue}**](${values.customEventLinkValue})\nServidor: ${values.customServerValue}\nPartida: ${values.customStartPlaceValue}\nDestino: ${values.customDestinationValue}\n\n**Reunión:** <t:${meetingTimestamp}:F> (<t:${meetingTimestamp}:R>)\n**Salida:** <t:${departureTimestamp}:t> (<t:${departureTimestamp}:R>)\n**${dtKey}** <t:${arrivalTimestamp}:t> (<t:${arrivalTimestamp}:R>)\n${ingameTimeLine}\n\nDescripción: ${values.customEventDescriptionValue}`;
        showFooterAction(state.currentLangData.footer_action_copying || 'Copying...');
        copyToClipboard(convoyInfo).then(() => showCopyMessage()).catch(err => console.error("[CLIPBOARD] Failed:", err));
    };

    dom.copyTmpBtn.onclick = () => {
        const values = getCommonValues();
        const meetingDateTime = validateDate(values);
        if (!meetingDateTime) return;

        const { meetingEmoji, departureEmoji, arrivalEmoji, departureDateTime, departureOffsetMinutes } = computeGameEmojis(meetingDateTime);
        const arrivalGameTime = getGameTime(meetingDateTime.plus({ minutes: departureOffsetMinutes + 50 }).toUTC());
        const arrivalEmojiFinal = getDetailedDayNightIcon(arrivalGameTime.hours);

        const includeImages = dom.tmpImagesToggle.checked;
        const activeZones = state.getActiveZones();
        let tmpInfo = `# ${values.customEventNameValue}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/green.png)\n\n`;
        tmpInfo += `## ${state.currentLangData.tmp_description_title || 'DESCRIPCIÓN'}\n> ${values.customEventDescriptionValue}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/purple.png)\n\n`;
        tmpInfo += `## ${state.currentLangData.tmp_event_info_title || 'INFORMACION DEL EVENTO'}\n`;
        tmpInfo += `* 🗓️ ${state.currentLangData.tmp_date_label || 'Fecha (UTC)'}: ${meetingDateTime.toUTC().toFormat('dd/MM/yyyy')}\n`;
        tmpInfo += `* ⏰ ${state.currentLangData.tmp_meeting_time_label || 'Reunión (UTC)'}: ${meetingDateTime.toUTC().toFormat('HH:mm')}\n`;
        tmpInfo += `* 🚚 ${state.currentLangData.tmp_departure_time_label || 'Salida (UTC)'}: ${departureDateTime.toUTC().toFormat('HH:mm')}\n`;
        tmpInfo += `* 🖥️ ${state.currentLangData.tmp_server_label || 'Servidor'}: ${values.customServerValue}\n`;
        tmpInfo += `* ➡️ ${state.currentLangData.tmp_start_place_label || 'Ciudad de Inicio'}: ${values.customStartPlaceValue}\n`;
        tmpInfo += `* ⬅️ ${state.currentLangData.tmp_destination_label || 'Ciudad de Destino'}: ${values.customDestinationValue}\n\n`;

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

        tmpInfo += `* ${itKey}: ${mKey}: ${meetingEmoji} ${sKey}: ${departureEmoji} ${aKey}: ${arrivalEmojiFinal}\n\n`;
        if (includeImages) tmpInfo += `![](https://convoyrama.github.io/event/images/default/orange.png)\n\n`;
        tmpInfo += `[${rKey}](https://truckersmp.com/rules)`;
        showFooterAction(state.currentLangData.footer_action_copying || 'Copying...');
        copyToClipboard(tmpInfo).then(() => showCopyMessage()).catch(err => console.error("[CLIPBOARD] Failed:", err));
    };
}
