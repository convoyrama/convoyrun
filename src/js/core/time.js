import { dom } from '../dom.js';
import { currentLangData } from './state.js';

const { DateTime } = luxon;

// Centralizado: repetido en cada caller causaba inconsistencias antes.
export function resolveMeetingDateTime(dateValue, timeValue, manualOffset) {
    if (manualOffset === 'auto') {
        return DateTime.fromISO(`${dateValue}T${timeValue}:00`);
    }
    const offsetMinutes = parseInt(manualOffset, 10) * 60;
    return DateTime.fromISO(`${dateValue}T${timeValue}:00`, { zone: 'utc' }).plus({ minutes: -offsetMinutes });
}

export function updateLiveClocks() {
    const now = DateTime.local();
    dom.localTimeDisplay.textContent = now.toLocaleString(DateTime.TIME_WITH_SECONDS);
}

export function formatTime(d) { return d.toFormat('HH:mm'); }

export function formatDateForDisplay(d) {
    const months = currentLangData.months || ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return `${d.day} de ${months[d.month - 1]} de ${d.year}`;
}

export function formatDateForDisplayShort(d) {
    const day = d.day;
    const months = currentLangData.months_short || ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${day} ${months[d.month - 1]}`;
}
