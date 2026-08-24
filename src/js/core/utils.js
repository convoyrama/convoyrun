import { dom } from '../dom.js';
import { timezoneCountryCodes } from './config.js';

/** Show/hide element using the `hidden` attribute + explicit display for shown state. */
export function setVisible(el, show, display) {
    if (!el) return;
    el.hidden = !show;
    if (show && display) el.style.display = display;
}

let _copyMessageTimeout = null;

export function showCopyMessage(message = "¡Información copiada al portapapeles!") {
    if (!dom.copyMessage) { console.warn('[UTILS] copyMessage element not found'); return; }
    if (_copyMessageTimeout) { clearTimeout(_copyMessageTimeout); }
    dom.copyMessage.textContent = message;
    setVisible(dom.copyMessage, true, 'block');
    _copyMessageTimeout = setTimeout(() => { setVisible(dom.copyMessage, false); _copyMessageTimeout = null; }, 2000);
}

export function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            lines.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}

export function pad(n) { return n < 10 ? "0" + n : n; }

// Las zonas que el usuario agrega a mano (state.activeZones sin key) traen
// su propio label; las de un preset se buscan por key como siempre.
export function getZoneLabel(tz, langData) {
    if (tz.key === null) return tz.label;
    return langData[tz.key] || (timezoneCountryCodes[tz.key] || [tz.key.replace('tz_', '').toUpperCase()]).join(', ');
}